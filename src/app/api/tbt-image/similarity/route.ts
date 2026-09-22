import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { recordProviderEvent } from '@/lib/provider-events'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Deteccion de plagio por similitud semantica — Update Package 01, N9.
 *
 * YA NO FALLA ABIERTO. Un escaneo que no corrio salia como `skipped` y el
 * asistente lo pintaba como limpio: con el proveedor caido, sin token o con la
 * clave rechazada, cada obra se registraba "sin conflictos". Ahora cualquier
 * fallo responde 503 `unavailable` y el asistente pausa el registro.
 *
 * `reason` separa la configuracion (`setup`: falta el token o fue rechazado)
 * de la caida (`outage`), porque la primera no se arregla esperando. Cada
 * intento, el que corrio y el que no, queda en provider_events.
 *
 * PIDE SESION. Era un proxy abierto delante de un servicio con GPU y clave
 * propia: cualquiera podia usarlo como API gratuita. El wizard de Brew ya
 * exige sesion antes de llegar aqui. Un 401 de esta ruta es falta de sesion,
 * no una caida, y el asistente lo trata aparte.
 *
 * PIVOTADO A HF + PGVECTOR (21 sept 2026, sin presupuesto para procesador
 * propio). El embedding se calcula en HF Inference API contra el mismo modelo
 * que iba a correr en el procesador (`google/siglip-base-patch16-224`), y la
 * busqueda de similitud se hace en Supabase pgvector contra `image_vectors`
 * con el operador `<=>` de distancia coseno. Federico condicion #1 se mantiene:
 * la comparacion vive en tbt.cafe.
 *
 * TAMBIEN GUARDA EL ESCANEO (Update Package 01, N9 a): cada resultado — clear,
 * warning, blocked — queda en `plagiarism_scans` para que la vista de trabajo
 * y las decisiones futuras tengan un rastro persistente.
 */

const THRESHOLD_BLOCK = 0.9
const THRESHOLD_WARN = 0.75

const HF_MODEL = 'google/siglip-base-patch16-224'
// HuggingFace retiro `api-inference.huggingface.co` — todo el trafico va por
// el router con rutas por pipeline.
const HF_INFERENCE_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`
const EXPECTED_EMBEDDING_DIM = 768

/** HF Inference: 30 s con warm, hasta 90 s con cold. 120 s de margen. */
const TIMEOUT_MS = 120_000

type Hit = { work_id: string; score: number }

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const token = process.env.HF_TOKEN
  const started = Date.now()

  async function unavailable(reason: 'setup' | 'outage', code: string, error?: unknown) {
    await recordProviderEvent({ provider: 'image_processor', operation: 'search_images', ok: false, error: { code, reason, detail: error instanceof Error ? error.message : (error ?? null) }, latencyMs: Date.now() - started })
    return NextResponse.json({ status: 'unavailable', reason }, { status: 503 })
  }

  if (!token) return unavailable('setup', 'token_unset')

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  try {
    // 1. Embed via HF Inference API.
    const bytes = new Uint8Array(await file.arrayBuffer())
    const embedResponse = await fetch(HF_INFERENCE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'X-Wait-For-Model': 'true',
      },
      body: new Blob([bytes as BlobPart], { type: file.type || 'application/octet-stream' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (embedResponse.status === 401 || embedResponse.status === 403) return unavailable('setup', 'token_rejected')
    if (!embedResponse.ok) return unavailable('outage', `http_${embedResponse.status}`)

    // Feature-extraction devuelve `number[]` o `number[][]` (batch de uno).
    const payload = (await embedResponse.json()) as unknown
    const flat: unknown[] =
      Array.isArray(payload) && payload.length > 0 && Array.isArray(payload[0])
        ? (payload[0] as unknown[])
        : (payload as unknown[])
    if (
      !Array.isArray(flat) ||
      flat.length !== EXPECTED_EMBEDDING_DIM ||
      !flat.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      return unavailable('outage', 'bad_embedding_shape')
    }
    const embedding = flat as number[]

    // 2. Comparar contra image_vectors. A la escala actual (decenas a bajos
    // miles de obras) traer todas las filas y hacer el coseno en JS es
    // rentable y no obliga a otra migracion. Los vectores estan L2-normalizados
    // (SigLIP los devuelve asi), asi que el producto punto es equivalente a la
    // similitud coseno.
    //
    // Cuando el volumen justifique el indice HNSW, se agrega una migracion con
    // un RPC `search_image_vectors(query vector, k int)` y se cambia esta rama
    // por `admin.rpc(...)`. El indice ya vive en la 049; falta solo la funcion.
    const admin = createAdminClient()
    const { data: rows, error: qErr } = await admin
      .from('image_vectors')
      .select('work_id, embedding')
      .limit(1000)
    if (qErr) return unavailable('outage', 'pgvector_query_failed', qErr.message)

    const hits: Hit[] = (rows ?? [])
      .map((r): Hit => {
        const raw = String(r.embedding as unknown as string)
        const parts = raw.replace(/^\[|\]$/g, '').split(',').map(Number)
        let dot = 0
        for (let i = 0; i < embedding.length; i++) dot += embedding[i] * (parts[i] ?? 0)
        return { work_id: String(r.work_id), score: dot }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    await recordProviderEvent({ provider: 'image_processor', operation: 'search_images', ok: true, latencyMs: Date.now() - started })

    // 3. Decidir clear / warning / blocked por umbrales.
    if (hits.length === 0) {
      await persistScan(admin, auth.user.id, 'clear', 0, [])
      return NextResponse.json({ status: 'clear' })
    }

    const topScore = hits[0].score
    if (topScore >= THRESHOLD_BLOCK) {
      await persistScan(admin, auth.user.id, 'blocked', topScore, hits.slice(0, 3))
      return NextResponse.json({ status: 'blocked', score: topScore, matches: hits.slice(0, 3) })
    }
    if (topScore >= THRESHOLD_WARN) {
      await persistScan(admin, auth.user.id, 'warning', topScore, hits.slice(0, 3))
      return NextResponse.json({ status: 'warning', score: topScore, matches: hits.slice(0, 3) })
    }
    await persistScan(admin, auth.user.id, 'clear', topScore, [])
    return NextResponse.json({ status: 'clear', score: topScore })
  } catch (error) {
    return unavailable('outage', 'unreachable', error)
  }
}

/**
 * N9 (a): un rastro persistente por escaneo. Si el insert falla, no se
 * arrastra: el flujo del usuario no depende de esto, es telemetria.
 */
async function persistScan(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  status: 'clear' | 'warning' | 'blocked',
  topScore: number,
  matches: Hit[],
) {
  try {
    await admin.from('plagiarism_scans').insert({
      user_id: userId,
      status,
      top_score: topScore,
      matches,
    })
  } catch (err) {
    console.error('[similarity] persistScan failed:', err)
  }
}
