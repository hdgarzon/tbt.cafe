import { recordProviderEvent } from '@/lib/provider-events'

/**
 * Un SMS directo — alarmas de seguridad y enlaces nuevos (Work Order 02, 10.2).
 *
 * Nunca lanza: una alarma que no sale no puede tumbar el cambio que la motivo.
 * El resultado queda en provider_events. El cliente de Twilio se construye al
 * llamar, no al importar (check:boot).
 */
export async function sendSms(to: string, body: string, operation: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  const started = Date.now()
  if (!sid || !token || !from || !to) {
    await recordProviderEvent({ provider: 'twilio', operation, ok: false, error: { code: 'not_configured' }, latencyMs: 0 })
    return false
  }
  try {
    const twilio = (await import('twilio')).default
    await twilio(sid, token).messages.create({ body, from, to })
    await recordProviderEvent({ provider: 'twilio', operation, ok: true, latencyMs: Date.now() - started })
    return true
  } catch (error) {
    await recordProviderEvent({ provider: 'twilio', operation, ok: false, error, latencyMs: Date.now() - started })
    return false
  }
}
