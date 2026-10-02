import { createHash } from 'crypto'
import { LEGAL_DOCS } from '@/lib/legal-content'

/**
 * La compra, antes del cargo — Work Order 02, Stage 0.5c y 0.8b.
 *
 * Las compuertas van en este orden: quien llama no es quien tiene la obra; las
 * ventas no estan en pausa; quien la tiene puede vender (activo, sin
 * suspension); la obra esta a la venta, o congelada por una oferta de quien
 * llama y dentro de su ventana de pago. Con una oferta aceptada el cargo es el
 * monto aceptado, nunca el de lista. La velocidad la comprueba la escalera.
 */

export type PurchaseFacts = {
  callerId: string
  holderId: string
  sellingPaused: boolean
  sellerActive: boolean
  availability: string
  listedPrice: number | null
  frozenOfferId: string | null
  offer: { id: string; fromUser: string; status: string; amount: number; paymentDueAt: string | null } | null
  now: number
}

export type PurchasePlan =
  | { ok: true; amount: number; offerId: string | null }
  | { ok: false; error: 'is_holder' | 'selling_paused' | 'seller_not_active' | 'not_for_sale' | 'offer_not_yours' | 'payment_window_closed' }

export function planPurchase(f: PurchaseFacts): PurchasePlan {
  if (f.callerId === f.holderId) return { ok: false, error: 'is_holder' }
  if (f.sellingPaused) return { ok: false, error: 'selling_paused' }
  if (!f.sellerActive) return { ok: false, error: 'seller_not_active' }

  if (f.frozenOfferId) {
    const o = f.offer
    if (!o || o.id !== f.frozenOfferId || o.fromUser !== f.callerId || o.status !== 'accepted') return { ok: false, error: 'offer_not_yours' }
    if (!o.paymentDueAt || new Date(o.paymentDueAt).getTime() <= f.now) return { ok: false, error: 'payment_window_closed' }
    return { ok: true, amount: o.amount, offerId: o.id }
  }

  if (f.availability !== 'for_sale' || !f.listedPrice || f.listedPrice <= 0) return { ok: false, error: 'not_for_sale' }
  return { ok: true, amount: f.listedPrice, offerId: null }
}

/** La version de los Terms que acepta un pago (0.8b): la huella de su texto. */
export function termsVersion(): string {
  const terms = LEGAL_DOCS.find((d) => d.slug === 'terms')
  return 'terms-' + createHash('sha256').update(JSON.stringify(terms ?? null)).digest('hex').slice(0, 12)
}
