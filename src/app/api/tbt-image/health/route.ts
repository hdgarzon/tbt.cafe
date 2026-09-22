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
 * PIVOTADO A HF ROUTER (22 sept 2026). HuggingFace retiro el dominio
 * `api-inference.huggingface.co` y su endpoint `/status/{model}`. El health
 * ahora hace un GET ligero al pipeline de feature-extraction con el token: HF
 * responde 4xx o 5xx segun el problema (401/403 = token rechazado, 5xx =
 * caida). Un 405 (GET no permitido, la ruta espera POST) es tambien una
 * confirmacion de que HF esta arriba — la contamos como disponible.
 *
 * La respuesta se guarda 30 s en memoria: el inicio la consulta al cargar, al
 * recuperar el foco y cada minuto, y no hace falta molestar a HF en cada una.
 * Solo se registra el fallo: un sondeo que va bien cada minuto llenaría
 * provider_events de filas que no dicen nada.
 */
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 8_000
const CACHE_MS = 30_000

const HF_MODEL = 'google/siglip-base-patch16-224'
const HF_PROBE_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`

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
    // GET sobre una ruta POST-only responde 405 con token valido, o 401/403
    // con token invalido. Cualquiera de las dos dice "HF esta arriba". Un 5xx
    // o un fetch failed dicen que no.
    const response = await fetch(HF_PROBE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) return down('setup', 'token_rejected')
    // 405 Method Not Allowed es la respuesta esperada del pipeline con GET —
    // confirma que la ruta existe y el token es aceptado. Cualquier 4xx no
    // relacionada a auth cuenta como caida; los 5xx tambien.
    if (response.status === 405 || response.ok) return { available: true }
    return down('outage', `http_${response.status}`)
  } catch (error) {
    return down('outage', 'unreachable', error)
  }
}
