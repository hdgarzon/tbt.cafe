import { NextResponse } from 'next/server'
import { recordProviderEvent } from '@/lib/provider-events'

/**
 * ¿Se puede registrar ahora? — Update Package 01, N9 (c, e).
 *
 * Sin escaneo de originalidad no hay registro. El inicio y Brew preguntan aquí
 * antes de abrir el flujo, y el aviso de pausa se va solo cuando la respuesta
 * vuelve a ser sí.
 *
 * SIN SESIÓN, a propósito: el aviso se ve en el inicio antes de autenticar.
 * Solo dice sí o no, y si la causa es configuración o caída; nada del
 * proveedor sale de aquí.
 *
 * PIVOTADO A HF INFERENCE API (21 sept 2026, sin presupuesto para procesador
 * propio). En vez de pingar `${TBT_IMAGE_PROCESSOR_URL}/health`, se pregunta a
 * HF por el estado del modelo con `GET /status/{model_id}`. HF distingue
 * `loaded` (respuesta inmediata) de `preloading` (cold; primer request se
 * demora) — cualquiera de los dos deja el registro abierto porque la ruta de
 * similarity ya pide `X-Wait-For-Model`.
 *
 * La respuesta se guarda 30 s en memoria: el inicio la consulta al cargar, al
 * recuperar el foco y cada minuto, y no hace falta molestar a HF en cada una.
 * Solo se registra el fallo: un sondeo que va bien cada minuto llenaría
 * provider_events de filas que no dicen nada.
 */
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 5_000
const CACHE_MS = 30_000

const HF_MODEL = 'google/siglip-base-patch16-224'
const HF_STATUS_URL = `https://api-inference.huggingface.co/status/${HF_MODEL}`

type Health = { available: true } | { available: false; reason: 'setup' | 'outage' }

let cached: { at: number; value: Health } | null = null

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) return reply(cached.value)
  const value = await probe()
  cached = { at: Date.now(), value }
  return reply(value)
}

function reply(value: Health) {
  return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } })
}

async function probe(): Promise<Health> {
  const token = process.env.HF_TOKEN
  const started = Date.now()

  async function down(reason: 'setup' | 'outage', code: string, error?: unknown): Promise<Health> {
    await recordProviderEvent({ provider: 'image_processor', operation: 'health', ok: false, error: { code, reason, detail: error instanceof Error ? error.message : (error ?? null) }, latencyMs: Date.now() - started })
    return reason === 'setup' ? { available: false, reason: 'setup' } : { available: false, reason: 'outage' }
  }

  if (!token) return down('setup', 'token_unset')

  try {
    const response = await fetch(HF_STATUS_URL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) return down('setup', 'token_rejected')
    if (!response.ok) return down('outage', `http_${response.status}`)

    // `state` puede ser 'Loadable' (cold, se levanta al primer request) o
    // 'Loaded' (warm). Ambos son "disponible" para nosotros — similarity envia
    // X-Wait-For-Model y espera. Solo un 4xx/5xx aqui es motivo de pausa.
    return { available: true }
  } catch (error) {
    return down('outage', 'unreachable', error)
  }
}
