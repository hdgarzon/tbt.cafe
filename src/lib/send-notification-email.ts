/**
 * Despacho de correo de notificaciones — Backend Spec 06 §1.1.
 *
 * El correo es alcance ADICIONAL. El feed dentro de la app ya recibió la
 * notificación pase lo que pase aquí, y por eso esta función nunca lanza: un
 * fallo de correo no puede tumbar la operación que lo originó ni impedir que la
 * persona se entere, porque ya se enteró.
 *
 * Un toggle por ítem: quien decide si esto se envía es la misma preferencia que
 * decide el feed, y se resolvió antes de llamar aquí. No hay matriz de canales.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { emailCopyFor, renderEmail, type Locale } from '@/lib/email-templates'
import { recordProviderEvent } from '@/lib/provider-events'

const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']
const SITE = 'https://tbt.cafe'

export async function sendNotificationEmail(
  supabase: SupabaseClient,
  params: { userId: string; eventKey: string; data: Record<string, unknown>; href?: string | null }
): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.RESEND_FROM_EMAIL

    /*
     * Sin credenciales no se envía y se DICE. La ruta antigua devolvía éxito en
     * este caso, que es como nadie supo durante meses que los correos de
     * certificación no salían — el mismo fallo que el MMS.
     */
    if (!apiKey || !from) {
      void recordProviderEvent({
        provider: 'resend',
        operation: 'send_notification',
        ok: false,
        error: { code: 'not_configured' },
        entityType: 'user',
        entityId: params.userId,
      })
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, language_override')
      .eq('id', params.userId)
      .single()

    // El correo es opcional en general (§2.2). Sin dirección no hay nada que
    // hacer, y no es un fallo: el feed ya cumplió.
    const to = profile?.email
    if (!to) return

    const locale = (LOCALES.find((l) => l === profile?.language_override) ?? 'en') as Locale

    const copy = emailCopyFor(
      params.eventKey,
      locale,
      Object.fromEntries(Object.entries(params.data).map(([k, v]) => [k, String(v)]))
    )
    // Sin plantilla completa no se manda nada. Antes que caer al inglés para
    // alguien que lee en español, el spec prefiere no publicar.
    if (!copy) return

    const href = params.href ? `${SITE}${params.href}` : null

    /*
     * Resend devuelve { data, error } en vez de lanzar. Un try/catch por sí solo
     * daría por bueno un envío fallido — que es exactamente el fallo que este
     * repo ha tenido con Twilio y con el correo de certificación. El error se
     * comprueba, no se asume.
     */
    const { data, error } = await new Resend(apiKey).emails.send({
      from,
      to,
      subject: copy.subject,
      html: renderEmail(copy, href),
      text: `${copy.heading}\n\n${copy.body}${href ? `\n\n${href}` : ''}`,
    })

    void recordProviderEvent({
      provider: 'resend',
      operation: 'send_notification',
      ok: !error,
      error: error ?? undefined,
      entityType: 'user',
      entityId: params.userId,
    })

    if (error) console.error('[notification-email] resend refused:', params.eventKey, error.name)
    else if (!data?.id) console.error('[notification-email] no id returned:', params.eventKey)
  } catch (error) {
    console.error('[notification-email] failed:', params.eventKey, error)
    void recordProviderEvent({
      provider: 'resend',
      operation: 'send_notification',
      ok: false,
      error,
      entityType: 'user',
      entityId: params.userId,
    })
  }
}
