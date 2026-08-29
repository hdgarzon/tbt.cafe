/**
 * Un contracargo deja rastro.
 *
 * Hasta ahora no lo dejaba: el webhook atendía dos eventos —la sesión
 * completada y la caducada— y todo lo demás caía en un `default` que solo
 * escribe en el log. Una disputa llegaba, Stripe sacaba el importe del saldo
 * de la plataforma más su comisión, y el sistema seguía tan tranquilo: la obra
 * transferida, la regalía acreditada, y el único aviso un correo a la bandeja
 * de alguien.
 *
 * LO QUE ESTE MÓDULO NO HACE
 *
 * No congela ganancias, no revierte certificaciones y no le escribe a nadie.
 * Quitarle a un creador una regalía porque un comprador disputó es una
 * decisión de negocio, no un efecto secundario de escuchar un webhook; y
 * `fileSystemTicket` no serviría para avisar en corto, porque abre un ticket
 * dirigido al cliente y dispara una notificación que no se puede silenciar.
 * Avisar al comprador que disputó, o al creador de que su dinero peligra, es
 * de quien lleva el negocio.
 *
 * Lo que sí hace es que la disputa exista en la base de datos, con lo que se
 * pudo resolver y con el evento entero por si no se pudo resolver nada.
 */

export type DisputeKind = 'dispute' | 'refund'

export type DisputeDescription = {
  /** `dp_…` para una disputa, `ch_…` para un reembolso. Es la clave primaria. */
  providerRef: string
  kind: DisputeKind
  chargeId: string | null
  paymentIntentId: string | null
  /** En dólares. Stripe cuenta en centavos. */
  amount: number
  currency: string
  status: string
  reason: string | null
}

/** Lo mínimo de un evento de Stripe que esto necesita leer. */
export type StripeEventLike = {
  type: string
  data: { object: unknown }
}

/**
 * Stripe manda unas veces el identificador y otras el objeto entero, según lo
 * que se haya expandido. Las dos formas valen y ninguna se puede dar por
 * supuesta.
 */
function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

function centsToDollars(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : 0
}

/**
 * Traduce el evento a la fila que se va a guardar, o `null` si el evento no
 * es de los que interesan.
 *
 * Un pago cuyo `payment_intent` no se llegó a guardar en su día NO se
 * descarta: se registra con el intent en nulo. Perder la disputa por no saber
 * a qué obra apunta sería exactamente el silencio que esto viene a romper, y
 * el evento crudo queda en la fila para reconstruirla a mano.
 */
export function describeDisputeEvent(event: StripeEventLike): DisputeDescription | null {
  const object = event?.data?.object
  if (!object || typeof object !== 'object') return null

  const o = object as Record<string, unknown>

  if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    const providerRef = idOf(o.id)
    if (!providerRef) return null

    return {
      providerRef,
      kind: 'dispute',
      chargeId: idOf(o.charge),
      paymentIntentId: idOf(o.payment_intent),
      amount: centsToDollars(o.amount),
      currency: typeof o.currency === 'string' ? o.currency : 'usd',
      status: typeof o.status === 'string' ? o.status : 'unknown',
      reason: typeof o.reason === 'string' ? o.reason : null,
    }
  }

  if (event.type === 'charge.refunded') {
    // Aquí el objeto es el cargo, no una disputa: su propio id es la
    // referencia, y por eso un reembolso parcial seguido de otro actualiza la
    // misma fila en vez de abrir una segunda.
    const providerRef = idOf(o.id)
    if (!providerRef) return null

    return {
      providerRef,
      kind: 'refund',
      chargeId: providerRef,
      paymentIntentId: idOf(o.payment_intent),
      amount: centsToDollars(o.amount_refunded),
      currency: typeof o.currency === 'string' ? o.currency : 'usd',
      status: o.refunded === true ? 'refunded' : 'partially_refunded',
      reason: null,
    }
  }

  return null
}
