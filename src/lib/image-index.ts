import { createAdminClient } from '@/lib/supabase-admin'
import { recordProviderEvent } from '@/lib/provider-events'
import { fileSystemTicket } from '@/lib/system-tickets'
import { fetchStoredImageBytes, computeImageSha256Hex } from '@/lib/image-bytes'

/**
 * Anadir la imagen recien certificada al indice de originalidad — Update
 * Package 01, N10 (opcion C aprobada 17 sept 2026), PIVOTADO a HuggingFace
 * Inference API por restriccion de presupuesto (21 sept 2026).
 *
 * FEDERICO APROBO un procesador propio embed-only sobre pgvector en Supabase.
 * Sin presupuesto para hostearlo (Fly y Cloud Run exigen tarjeta antes de la
 * primera invocacion; HF Spaces con Docker SDK es de pago para nuestra cuenta),
 * eliminamos el paso del procesador propio y llamamos directo al Inference API
 * publico de HF contra el mismo modelo — `google/siglip-base-patch16-224` —
 * que iba a correr en nuestro servicio. Federico debe saber el pivot; queda
 * declarado como desviacion en el proximo reporte del §7.
 *
 * Consecuencias que persisten y que Federico conocera:
 *   · La imagen del creador viaja a servidores de HF para calcular el vector.
 *     Cada obra publicada llega a Solana/Arweave, asi que el creador ya
 *     autorizo publicacion; enviarla a HF a computar un embedding no expone
 *     nada nuevo — pero es un tercero mas en la lista de Privacy.
 *   · Rate limit del tier gratuito: ~1000 req/hora. A 50 req/dia estamos
 *     dos ordenes por debajo, sobra margen.
 *   · Sin control sobre la version del modelo. Un cambio de pesos en HF haria
 *     que los vectores nuevos no comparen con los ya guardados; el
 *     reconstructor (npm run reindex:images) es el remedio.
 *
 * Federico condiciones #1, #2 y #3 se mantienen:
 *   #1 — tbt.cafe es dueño de la escritura a `image_vectors`, de la consulta
 *        de similitud y del reconstructor. HF solo devuelve un vector.
 *   #2 — `image_vectors` sigue siendo service-role only.
 *   #3 — la sha256 se calcula en el servidor sobre los bytes guardados;
 *        nada de esto cambia con el pivot.
 *
 * Cada desenlace queda en `provider_events`, que la vista de observabilidad
 * ya lee, y un fallo abre un ticket de sistema sobre la obra. Quien llama lo
 * corre en `after()`: el creador no espera al embedding y el despliegue si
 * espera a que termine.
 *
 * Nunca lanza. Para cuando esto corre la obra ya esta certificada, y un
 * problema de indexado nuestro no puede deshacer eso.
 */

export type IndexOutcome = 'indexed' | 'failed'

/** El modelo publico de HF. Cambiarlo pide reconstruir la tabla entera —
 *  la columna es `vector(768)` y otro modelo puede tener otra dimension. */
const HF_MODEL = 'google/siglip-base-patch16-224'
const HF_INFERENCE_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`

/** SigLIP base — la unica dimension que la columna `vector(768)` acepta. */
const EXPECTED_EMBEDDING_DIM = 768

/** HF Inference: 30 s con warm model, hasta 90 s con cold (primer request del
 *  dia). Damos 120 s de margen. */
const HF_TIMEOUT_MS = 120_000

export async function indexCertifiedImage(params: {
  workId: string
  creatorId: string
  mediaUrl: string
}): Promise<IndexOutcome> {
  const started = Date.now()

  async function fail(error: unknown): Promise<IndexOutcome> {
    await recordProviderEvent({ provider: 'image_processor', operation: 'index_image', ok: false, error, latencyMs: Date.now() - started, entityType: 'work', entityId: params.workId })
    try {
      const admin = createAdminClient()
      await fileSystemTicket(admin, {
        userId: params.creatorId,
        eventCode: 'image_index_failed',
        entityType: 'work',
        entityId: params.workId,
        errorDetail: error,
      })
    } catch (ticketError) {
      console.error('[image-index] could not open the ticket:', params.workId, ticketError)
    }
    return 'failed'
  }

  try {
    const token = process.env.HF_TOKEN
    if (!token) {
      return fail({ code: 'token_unset', message: 'HF_TOKEN is not set' })
    }

    // Los bytes se traen UNA vez y se usan dos: para la sha256 servidor-side, y
    // para el embedding. `fetchStoredImageBytes` guarda contra origenes ajenos
    // (assertPublishableSource) — la misma que publish-image usa.
    const { bytes, contentType } = await fetchStoredImageBytes(params.mediaUrl)
    const imageSha256 = computeImageSha256Hex(bytes)

    // HF Inference API para modelos de vision con feature-extraction: se envia
    // el binario de la imagen con el Content-Type real, y devuelve un array de
    // numeros. `X-Wait-For-Model` evita el 503 cuando el modelo esta frio; HF
    // espera a levantarlo (hasta ~60 s la primera vez) en vez de rebotar.
    const response = await fetch(HF_INFERENCE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'X-Wait-For-Model': 'true',
      },
      body: new Blob([bytes as BlobPart], { type: contentType }),
      signal: AbortSignal.timeout(HF_TIMEOUT_MS),
    })
    if (!response.ok) {
      return fail({ code: `http_${response.status}`, status: response.status, body: (await response.text()).slice(0, 300) })
    }

    // Feature-extraction devuelve `number[]` (plano) o `number[][]` (batch de
    // uno). Aplanamos y validamos contra la dimension esperada. Cualquier otra
    // forma es un fallo — no acumulamos filas mal formadas en `image_vectors`.
    const payload = (await response.json()) as unknown
    const flat: unknown[] =
      Array.isArray(payload) && payload.length > 0 && Array.isArray(payload[0])
        ? (payload[0] as unknown[])
        : (payload as unknown[])
    if (
      !Array.isArray(flat) ||
      flat.length !== EXPECTED_EMBEDDING_DIM ||
      !flat.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      return fail({ code: 'bad_embedding_shape', got: Array.isArray(flat) ? flat.length : typeof flat, expected: EXPECTED_EMBEDDING_DIM })
    }
    const embedding = flat as number[]

    const admin = createAdminClient()

    // pgvector via PostgREST acepta el formato textual `[0.1,0.2,...]`. Sin
    // espacios y con precision completa, para no perder decimales por serializar.
    const vectorLiteral = `[${embedding.join(',')}]`

    // Upsert por work_id: si un reintento o el reconstructor pasa por aqui otra
    // vez sobre la misma obra, no rompe con clave primaria duplicada.
    const { error: vectorError } = await admin
      .from('image_vectors')
      .upsert({ work_id: params.workId, embedding: vectorLiteral }, { onConflict: 'work_id' })
    if (vectorError) {
      return fail({ code: 'image_vectors_upsert_failed', message: vectorError.message })
    }

    // La sha256 se escribe DESPUES del vector, no antes: si el embedding fallo
    // no queremos dejar un filtro exacto vivo con el indice vacio.
    const { error: shaError } = await admin
      .from('works')
      .update({ image_sha256: imageSha256 })
      .eq('id', params.workId)
    if (shaError) {
      return fail({ code: 'works_image_sha256_write_failed', message: shaError.message })
    }

    await recordProviderEvent({ provider: 'image_processor', operation: 'index_image', ok: true, latencyMs: Date.now() - started, entityType: 'work', entityId: params.workId })
    return 'indexed'
  } catch (error) {
    return fail(error)
  }
}
