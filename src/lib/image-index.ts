import { createAdminClient } from '@/lib/supabase-admin'
import { recordProviderEvent } from '@/lib/provider-events'
import { fileSystemTicket } from '@/lib/system-tickets'
import { fetchStoredImageBytes, computeImageSha256Hex } from '@/lib/image-bytes'

/**
 * Anadir la imagen recien certificada al indice de originalidad — Update
 * Package 01, N10 (opcion C aprobada 17 septiembre 2026).
 *
 * El indice nunca guardo nada y nadie se entero: `complete-tbt` mandaba la
 * imagen con un `fetch` sin esperar, a una ruta propia que respondia 200
 * aunque el procesador la rechazara, y el fallo acababa en una linea de log
 * que caduca. La 049 movio el indice a `image_vectors` en Supabase; aqui se
 * escribe.
 *
 * El procesador solo devuelve un vector. Nada de credenciales de Supabase en
 * el otro lado, y el conteo del indice cabe en una consulta contra `works`
 * (N10 c). Federico condicion #1.
 *
 * En la misma llamada se calcula `image_sha256` de los bytes guardados, en el
 * servidor, y se escribe sobre la obra. Federico condicion #3: nunca sobre lo
 * que declara el navegador. Es el filtro exacto que se corre antes de cobrar
 * en la proxima subida; atrapa solo copias byte-identicas — una reencodificacion
 * pasa por el, y solo la busqueda de similitud (image_vectors) la ve.
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

/** El procesador calcula el embedding en CPU; mas que esto es un procesador colgado. */
const PROCESSOR_TIMEOUT_MS = 90_000

/** SigLIP base — la unica dimension que la columna `vector(768)` acepta. */
const EXPECTED_EMBEDDING_DIM = 768
const EXPECTED_MODEL_PREFIX = 'google/siglip-base'

type EmbedResponse = {
  embedding: number[]
  dim: number
  model: string
}

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
    const url = process.env.TBT_IMAGE_PROCESSOR_URL
    const key = process.env.TBT_IMAGE_PROCESSOR_API_KEY ?? ''

    // Sin URL no se indexa nada, en ninguna obra. Es un fallo de configuracion,
    // y callarlo es exactamente como el indice se quedo vacio.
    if (!url) {
      return fail({ code: 'url_unset', message: 'TBT_IMAGE_PROCESSOR_URL is not set' })
    }

    // Los bytes se traen UNA vez y se usan dos: para la sha256 servidor-side, y
    // para el embedding. `fetchStoredImageBytes` guarda contra origenes ajenos
    // (assertPublishableSource) — la misma que publish-image usa.
    const { bytes, contentType } = await fetchStoredImageBytes(params.mediaUrl)
    const imageSha256 = computeImageSha256Hex(bytes)

    const form = new FormData()
    form.append(
      'file',
      new Blob([bytes as BlobPart], { type: contentType }),
      params.mediaUrl.split('/').pop() || 'image.jpg',
    )

    const response = await fetch(`${url}/embed`, {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: form,
      signal: AbortSignal.timeout(PROCESSOR_TIMEOUT_MS),
    })
    if (!response.ok) {
      return fail({ code: `http_${response.status}`, status: response.status, body: (await response.text()).slice(0, 300) })
    }

    const payload = (await response.json()) as Partial<EmbedResponse>
    if (!Array.isArray(payload.embedding) || payload.embedding.length !== EXPECTED_EMBEDDING_DIM) {
      return fail({ code: 'bad_embedding_shape', got: payload.embedding?.length, expected: EXPECTED_EMBEDDING_DIM })
    }
    if (payload.dim !== EXPECTED_EMBEDDING_DIM) {
      return fail({ code: 'bad_embedding_dim', got: payload.dim, expected: EXPECTED_EMBEDDING_DIM })
    }
    if (typeof payload.model !== 'string' || !payload.model.startsWith(EXPECTED_MODEL_PREFIX)) {
      return fail({ code: 'unexpected_model', model: payload.model, expected: `${EXPECTED_MODEL_PREFIX}*` })
    }

    const admin = createAdminClient()

    // pgvector via PostgREST acepta el formato textual `[0.1,0.2,...]`. Sin
    // espacios y con precision completa, para no perder decimales por serializar.
    const vectorLiteral = `[${payload.embedding.join(',')}]`

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
