/**
 * Registro de llamadas a proveedores — Backend Spec 07 §2.7.
 *
 * Antes esto era `console.error`. Sirve para depurar un caso si sabes cuándo
 * ocurrió; no sirve para ver que Twilio lleva fallando desde el martes. El spec
 * pide errores agrupados con frecuencia y primera/última aparición, y eso
 * necesita quedar escrito en algún sitio consultable.
 *
 * Complementa a los tickets, no los sustituye: aquí se ve el patrón, allá el
 * impacto en una persona concreta.
 */
import { createAdminClient } from '@/lib/supabase-admin'

export type Provider = 'stripe' | 'twilio' | 'solana' | 'gemini' | 'resend' | 'image_processor'

/**
 * Código corto y estable para agrupar.
 *
 * Los mensajes de error llevan identificadores dentro —una sesión de Stripe, un
 * SID de Twilio— y usarlos tal cual haría que cada fallo fuese su propio grupo,
 * que es justo lo contrario de ver un patrón.
 */
function codeFor(error: unknown): string {
  if (!error) return 'unknown'
  const e = error as { code?: string; type?: string; status?: number; message?: string }
  if (e.code) return String(e.code)
  if (e.type) return String(e.type)
  if (e.status) return `http_${e.status}`
  if (e.message) {
    // Sin identificadores: se recorta a algo reconocible y estable.
    return e.message.replace(/[0-9a-f]{8,}/gi, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'unknown'
  }
  return 'unknown'
}

/**
 * Deja constancia de una llamada a un proveedor.
 *
 * Nunca lanza y nunca espera a nadie: si el registro fallara y tumbara la
 * operación, la observabilidad habría causado el incidente que pretendía
 * observar.
 */
export async function recordProviderEvent(params: {
  provider: Provider
  operation: string
  ok: boolean
  error?: unknown
  latencyMs?: number
  entityType?: string
  entityId?: string
}): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from('provider_events').insert({
      provider: params.provider,
      operation: params.operation,
      ok: params.ok,
      error_code: params.ok ? null : codeFor(params.error),
      error_detail: params.ok
        ? null
        : { message: (params.error as { message?: string })?.message ?? String(params.error) },
      latency_ms: params.latencyMs ?? null,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
    })
  } catch (err) {
    console.error('[provider-events] could not record:', params.provider, params.operation, err)
  }
}

/** Envuelve una llamada y registra su desenlace y su latencia. */
export async function trackProvider<T>(
  meta: { provider: Provider; operation: string; entityType?: string; entityId?: string },
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now()
  try {
    const result = await fn()
    void recordProviderEvent({ ...meta, ok: true, latencyMs: Date.now() - started })
    return result
  } catch (error) {
    void recordProviderEvent({ ...meta, ok: false, error, latencyMs: Date.now() - started })
    throw error
  }
}
