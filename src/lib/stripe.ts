import Stripe from 'stripe'
import { SERVICE_FEE_CENTS, PLATFORM_CURRENCY } from '@/lib/fees'

/**
 * El cliente de Stripe, construido en el primer uso y no al importar.
 *
 * En el backend este modulo lanzaba en el cuerpo: sin `STRIPE_SECRET_KEY`, el
 * `import` fallaba. Eso no rompe la llamada que necesita la clave, rompe el
 * grafo entero — cualquier ruta que importe esto, y por transitividad el
 * build. Es la forma exacta del fallo que tuvo los previews de este repo en
 * rojo durante semanas.
 *
 * Construido perezosamente, una ruta sin clave devuelve un 500 con una frase
 * legible y el resto del despliegue sigue en pie. El Proxy existe para que los
 * sitios de llamada no cambien: `stripe.checkout.sessions.create(...)` sigue
 * escribiendose igual.
 */
let client: Stripe | null = null

function stripeClient(): Stripe {
  if (client) return client
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is required')
  client = new Stripe(key, { typescript: true })
  return client
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const c = stripeClient()
    const value = c[prop as keyof Stripe]
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(c) : value
  },
})

// Payment configuration — la tarifa sale de fees.ts, que es su unica casa
export const PAYMENT_CONFIG = {
  tbtCreation: {
    amount: SERVICE_FEE_CENTS, // $8.00 (Spec 01, ítem 2)
    currency: PLATFORM_CURRENCY,
    description: 'TBT Creation Fee',
  },
  transfer: {
    amount: SERVICE_FEE_CENTS, // $8.00 — la misma tarifa de servicio, un solo origen
    currency: PLATFORM_CURRENCY,
    description: 'TBT Transfer Fee',
  },
}

// Type for checkout session creation
export type CheckoutType = 'tbt_creation' | 'transfer'

export interface CreateCheckoutParams {
  type: CheckoutType
  workId: string
  userId: string
  successUrl: string
  cancelUrl: string
  transferId?: string
  /** Royalty amount in dollars (added on top of the base fee for transfers) */
  royaltyAmount?: number
  /**
   * Checkout embebido (Backend Spec 01 §3.1): el cliente no sale de tbt.cafe.
   * Cuando se pide, Stripe devuelve un client_secret en vez de una URL, y el
   * retorno es una sola `returnUrl` — `cancel_url` no se admite en este modo.
   */
  embedded?: boolean
  returnUrl?: string
  /**
   * Fuerza 3D Secure — Backend Spec 01 §5.1, desde el umbral alto.
   *
   * `any` es "solicita 3DS según la lógica de tu propio motor de fraude", que
   * es justo lo que es la escalera, y sobrescribe las reglas dinámicas de
   * Radar. `challenge` forzaría el reto siempre, más fricción de la que pide
   * el spec.
   *
   * Es la ÚNICA medida de la escalera que traslada la responsabilidad del
   * fraude al banco emisor, y la razón entera de que exista el escalón de
   * \$1.000 (§5.2).
   */
  requireThreeDS?: boolean
  /**
   * Código de promoción de Stripe YA RESUELTO (`promo_...`), no el texto que
   * escribió la persona. Stripe aplica el descuento y lleva el conteo de
   * canjes, así que el importe se calcula una sola vez y en un solo sitio —
   * que es lo que pide el §1A.1: pantalla y cobro salen del mismo valor.
   */
  promotionCodeId?: string
}

export async function createCheckoutSession(params: CreateCheckoutParams) {
  const { type, workId, userId, successUrl, cancelUrl, transferId, royaltyAmount = 0, embedded = false, returnUrl, requireThreeDS = false, promotionCodeId } = params
  const config = type === 'tbt_creation' ? PAYMENT_CONFIG.tbtCreation : PAYMENT_CONFIG.transfer

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: config.currency,
        product_data: {
          name: config.description,
          description: `Work ID: ${workId}`,
        },
        unit_amount: config.amount,
      },
      quantity: 1,
    },
  ]

  // Add royalty line item for transfers
  if (type === 'transfer' && royaltyAmount > 0) {
    lineItems.push({
      price_data: {
        currency: config.currency,
        product_data: {
          name: 'Regalía del Artista',
          description: 'Royalty por transferencia de obra',
        },
        unit_amount: Math.round(royaltyAmount * 100), // convert to cents
      },
      quantity: 1,
    })
  }

  const metadata = {
    type,
    workId,
    userId,
    transferId: transferId || '',
  }

  // Sin `payment_method_types` Stripe decide qué métodos mostrar según el
  // dispositivo, que es lo que pide el selector del spec (§1A): a un usuario de
  // Android no se le enseña un Apple Pay inservible.
  const discounts = promotionCodeId ? [{ promotion_code: promotionCodeId }] : undefined

  const cardOptions: Stripe.Checkout.SessionCreateParams.PaymentMethodOptions | undefined =
    requireThreeDS ? { card: { request_three_d_secure: 'any' } } : undefined

  if (embedded) {
    return stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      line_items: lineItems,
      return_url: returnUrl,
      metadata,
      ...(cardOptions ? { payment_method_options: cardOptions } : {}),
      ...(discounts ? { discounts } : {}),
    })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    ...(cardOptions ? { payment_method_options: cardOptions } : {}),
    ...(discounts ? { discounts } : {}),
  })

  return session
}
