import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { recordProviderEvent } from '@/lib/provider-events'

/**
 * Detección de plagio por similitud semántica — proxy al tbt_image_processor.
 *
 * YA NO FALLA ABIERTO (Update Package 01, N9). Un escaneo que no corrió salía
 * como `skipped` y el asistente lo pintaba como limpio: con el procesador
 * caído, sin URL o con la clave rechazada, cada obra se registraba "sin
 * conflictos". Ahora cualquier fallo responde 503 `unavailable` y el asistente
 * pausa el registro.
 *
 * `reason` separa la configuración (`setup`: falta la URL o la clave, o la
 * clave fue rechazada) de la caída (`outage`), porque la primera no se arregla
 * esperando. Cada intento, el que corrió y el que no, queda en provider_events.
 *
 * PIDE SESION. Era un proxy abierto delante de un servicio con GPU y clave
 * propia: cualquiera podia usarlo como API gratuita. El wizard de Brew ya exige
 * sesion antes de llegar aqui. Un 401 de esta ruta es falta de sesion, no una
 * caida, y el asistente lo trata aparte.
 */

const THRESHOLD_BLOCK = 0.9
const THRESHOLD_WARN = 0.75

/** El procesador calcula el embedding en CPU; más que esto es un procesador colgado. */
const TIMEOUT_MS = 60_000

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const url = process.env.TBT_IMAGE_PROCESSOR_URL
  const key = process.env.TBT_IMAGE_PROCESSOR_API_KEY
  const started = Date.now()

  async function unavailable(reason: 'setup' | 'outage', code: string, error?: unknown) {
    await recordProviderEvent({ provider: 'image_processor', operation: 'search_images', ok: false, error: { code, reason, detail: error instanceof Error ? error.message : (error ?? null) }, latencyMs: Date.now() - started })
    return NextResponse.json({ status: 'unavailable', reason }, { status: 503 })
  }

  if (!url) return unavailable('setup', 'url_unset')
  if (!key) return unavailable('setup', 'key_missing')

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  try {
    const upstream = new FormData()
    upstream.append('file', file)
    upstream.append('top_k', '5')

    const response = await fetch(`${url}/search/images`, {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status === 401 || response.status === 403) return unavailable('setup', 'key_rejected')
    if (!response.ok) return unavailable('outage', `http_${response.status}`)

    const data = await response.json()
    await recordProviderEvent({ provider: 'image_processor', operation: 'search_images', ok: true, latencyMs: Date.now() - started })

    const hits = data.hits ?? []
    if (hits.length === 0) return NextResponse.json({ status: 'clear' })

    const topScore: number = hits[0].score
    if (topScore >= THRESHOLD_BLOCK) {
      return NextResponse.json({ status: 'blocked', score: topScore, matches: hits.slice(0, 3) })
    }
    if (topScore >= THRESHOLD_WARN) {
      return NextResponse.json({ status: 'warning', score: topScore, matches: hits.slice(0, 3) })
    }
    return NextResponse.json({ status: 'clear', score: topScore })
  } catch (error) {
    return unavailable('outage', 'unreachable', error)
  }
}
