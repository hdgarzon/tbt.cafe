/**
 * Escritura de notificaciones — Backend Spec 06 §1 y §5.
 *
 * El feed dentro de la app es el canal de registro: todo el mundo recibe todo
 * ahí. Por eso esta función escribe SIEMPRE en el feed, y el correo (cuando
 * exista el despacho) es alcance adicional que va con el mismo interruptor.
 *
 * Un toggle por ítem, no una matriz de canales: cuando está encendido va al
 * feed y al correo; apagado, a ninguno. El control por categoría y canal se
 * consideró y se descartó — duplica la superficie de ajustes para servir una
 * preferencia que casi nadie toca.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendNotificationEmail } from '@/lib/send-notification-email'

export type NotificationCategory = 'tbt' | 'security' | 'transactional' | 'support' | 'payouts'

/**
 * Las protectoras (§5.3). No se consulta la preferencia porque no se pueden
 * apagar: quien pudiera silenciar un cambio de destino de cobro o un cobro
 * fallido podría redirigir dinero sin que nadie lo note, y el silencio ahí es
 * activamente dañino.
 */
const ALWAYS_ON = new Set([
  'payout_destination',
  'payout_failed',
  'suspicious',
  'ticket_system',
])

const CATEGORY_OF: Record<string, NotificationCategory> = {
  views_created: 'tbt',
  views_collection: 'tbt',
  favorites: 'tbt',
  surge: 'tbt',
  new_from_followed: 'tbt',
  new_location: 'security',
  new_device: 'security',
  suspicious: 'security',
  purchases: 'transactional',
  transfers: 'transactional',
  registrations: 'transactional',
  offer_received: 'transactional',
  offer_accepted: 'transactional',
  offer_declined: 'transactional',
  offer_expiring: 'transactional',
  ticket_reply: 'support',
  ticket_system: 'support',
  payout_available: 'payouts',
  payout_released: 'payouts',
  payout_completed: 'payouts',
  payout_failed: 'payouts',
  payout_destination: 'security',
}

/**
 * Deja una notificación en el feed de alguien.
 *
 * Se guardan la clave del evento y sus datos, no el texto ya traducido: el
 * idioma se resuelve al pintar, así que quien cambia de idioma ve su historial
 * entero en el idioma nuevo en vez de un archivo mezclado.
 *
 * Nunca lanza. Una notificación perdida es molesta; tumbar la operación que la
 * originó lo es más.
 */
export async function notify(
  _client: SupabaseClient,
  params: {
    userId: string
    /** Coincide con el id de la preferencia: 'purchases', 'offer_received'… */
    eventKey: string
    data?: Record<string, unknown>
    /** Ruta interna a la que lleva. */
    href?: string
  }
): Promise<void> {
  try {
    // Escribe SIEMPRE como plataforma. Las políticas de `notifications` solo
    // dejan al cliente leer y marcar como leída: si pudiera insertar, cualquiera
    // podría fabricarse un aviso de seguridad con aspecto oficial. El cliente
    // que llega por parámetro lleva el token de la persona y aquí no sirve.
    const supabase = createAdminClient()
    const category = CATEGORY_OF[params.eventKey]
    if (!category) {
      console.error('[notify] unknown event key:', params.eventKey)
      return
    }

    if (!ALWAYS_ON.has(params.eventKey)) {
      const { data: enabled } = await supabase.rpc('notification_enabled', {
        who: params.userId,
        item: params.eventKey,
      })
      // Silencio del usuario = valor por defecto = recibirla. Quien nunca abrió
      // los ajustes no debería perderse una venta.
      if (enabled === false) return
    }

    const { error } = await supabase.from('notifications').insert({
      user_id: params.userId,
      event_key: params.eventKey,
      category,
      params: params.data ?? {},
      href: params.href ?? null,
    })
    if (error) {
      console.error('[notify] insert failed:', params.eventKey, error)
      return
    }

    /*
     * El correo va DESPUÉS del feed y con el mismo interruptor: si llegó hasta
     * aquí, la preferencia ya dijo que sí. No se espera —el feed es el canal de
     * registro y ya cumplió— así que un correo lento no retiene a nadie.
     */
    void sendNotificationEmail(supabase, {
      userId: params.userId,
      eventKey: params.eventKey,
      data: params.data ?? {},
      href: params.href,
    })
  } catch (err) {
    console.error('[notify] threw:', params.eventKey, err)
  }
}
