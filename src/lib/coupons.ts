/**
 * El descuento vive en Stripe, y ahora solo en Stripe.
 *
 * Había dos listas de cupones para el mismo dato: una hoja de cálculo decidía
 * lo que decía la pantalla, y Stripe decidía lo que se cobraba. Con dos
 * fuentes, un código presente en una y ausente en la otra fallaba por los dos
 * lados —la hoja anunciaba un descuento que `create-checkout` rechazaba, y un
 * código legítimo de Stripe se descartaba antes de que Stripe llegara a
 * verlo—. La hoja nunca llegó a configurarse, así que en la práctica pasaba
 * siempre lo segundo: ningún cupón funcionó jamás desde la interfaz.
 *
 * Este módulo solo traduce la promoción a lo que la pantalla necesita mostrar.
 * El cobro lo aplica Stripe con el mismo código, de modo que el importe y la
 * etiqueta salen del mismo valor (Spec 01 §1A.1).
 */

export type CouponType = 'percentage' | 'fixed'

export type CouponDescription = {
  /** El código tal como lo guarda Stripe, no como se tecleó. */
  code: string
  type: CouponType
  /** Porcentaje (20 = 20%) o dólares (3 = $3). Nunca centavos. */
  value: number
}

/** La forma mínima del cupón que esto necesita leer. */
export type CouponLike = {
  valid: boolean
  percent_off?: number | null
  amount_off?: number | null
}

/**
 * La promoción, ya resuelta por quien llama.
 *
 * En el SDK el cupón cuelga de `promotion` y puede venir como identificador;
 * traducir eso es trabajo de la ruta, no de aquí. Así este módulo no se mueve
 * cuando Stripe cambia la forma de su respuesta.
 */
export type PromotionCodeLike = {
  code: string
  active: boolean
  coupon: CouponLike | null
}

/**
 * Devuelve `null` cuando no hay un descuento que Stripe vaya a aplicar.
 *
 * Anunciar lo que el cobro va a rechazar es exactamente el fallo que este
 * cambio cierra, así que la desactivada, la caducada y la de importe cero se
 * tratan igual que un código inexistente.
 */
export function describePromotionCode(
  promo: PromotionCodeLike | null | undefined
): CouponDescription | null {
  if (!promo?.active) return null

  const coupon = promo.coupon
  if (!coupon?.valid) return null

  if (typeof coupon.percent_off === 'number' && coupon.percent_off > 0) {
    return { code: promo.code, type: 'percentage', value: coupon.percent_off }
  }

  if (typeof coupon.amount_off === 'number' && coupon.amount_off > 0) {
    // Stripe cuenta en centavos; la pantalla, en dólares.
    return { code: promo.code, type: 'fixed', value: coupon.amount_off / 100 }
  }

  return null
}
