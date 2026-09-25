import { NextResponse } from 'next/server'
import { recordProviderEvent } from '@/lib/provider-events'
import { createAdminClient } from '@/lib/supabase-admin'
import { outageIsOpen } from '@/lib/scan-outages'

/**
 * ¿Se puede registrar ahora? — Update Package 01, N9 (c, e).
 *
 * Sin escaneo de originalidad no hay registro. El inicio y Brew preguntan aquí
 * antes de abrir el flujo, y el aviso de pausa se va solo cuando la respuesta
 * vuelve a ser sí.
 *
 * SIN SESIÓN, a propósito: el aviso se ve en el inicio antes de autenticar.
 * Solo dice sí o no, y si la causa es configuración o caída; nada del
 * procesador sale de aquí.
 *
 * Pregunta dos cosas. `/health` es público y dice si el servicio responde,
 * pero no pide la clave; una clave rechazada también deja el registro sin
 * escaneo, así que se hace además una llamada mínima con ella contra `/embed`.
 * Un 405 o un 422 de esa llamada confirman que la ruta existe y la clave pasó
 * — lo único que nos interesa aquí. Un 401 o 403 dicen lo contrario.
 *
 * La respuesta se guarda 30 s en memoria: el inicio la consulta al cargar, al
 * recuperar el foco y cada minuto, y no hace falta molestar al procesador en
 * cada una. Solo se registra el fallo: un sondeo que va bien cada minuto
 * llenaría provider_events de filas que no dicen nada.
 */
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 8_000
const CACHE_MS = 30_000

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
  const url = process.env.TBT_IMAGE_PROCESSOR_URL
  const key = process.env.TBT_IMAGE_PROCESSOR_API_KEY
  const started = Date.now()

  async function down(reason: 'setup' | 'outage', code: string, error?: unknown): Promise<Health> {
    await recordProviderEvent({ provider: 'image_processor', operation: 'health', ok: false, error: { code, reason, detail: error instanceof Error ? error.message : (error ?? null) }, latencyMs: Date.now() - started })
    return reason === 'setup' ? { available: false, reason: 'setup' } : { available: false, reason: 'outage' }
  }

  if (!url) return down('setup', 'url_unset')
  if (!key) return down('setup', 'key_missing')

  try {
    const health = await fetch(`${url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!health.ok) return down('outage', `http_${health.status}`)

    // La clave no la pide `/health`, asi que se prueba contra `/embed` con un
    // GET: la ruta es POST-only, de modo que con clave valida responde 405 y
    // con clave rechazada responde 401 o 403. No se manda ninguna imagen.
    const keyed = await fetch(`${url}/embed`, {
      method: 'GET',
      headers: { 'X-API-Key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (keyed.status === 401 || keyed.status === 403) return down('setup', 'key_rejected')
    if (keyed.status !== 405 && keyed.status !== 422 && !keyed.ok) {
      return down('outage', `http_${keyed.status}`)
    }

    await closeOutage(started)
    return { available: true }
  } catch (error) {
    return down('outage', 'unreachable', error)
  }
}

/**
 * Un exito solo se escribe cuando cierra una caida — N9 (f). La alerta de
 * operador es la racha de fallos de `health` en provider_events; sin este
 * cierre, una caida ya resuelta seguiria abierta en la vista. Un exito que no
 * cierra nada no se escribe: seria una fila por minuto que no dice nada.
 */
async function closeOutage(started: number) {
  try {
    if (await outageIsOpen(createAdminClient())) {
      await recordProviderEvent({ provider: 'image_processor', operation: 'health', ok: true, latencyMs: Date.now() - started })
    }
  } catch {
    // Sin clave de servidor (preview) no hay a quien cerrarle nada.
  }
}
