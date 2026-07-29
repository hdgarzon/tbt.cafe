/**
 * Modelo de tarifas — portado VERBATIM del prototipo tbt-espresso.html.
 * Fuente de verdad única para precios, regalías y tarifas en toda la app.
 *
 * - Tarifa de servicio plana: $8 (sin porcentaje en ventas estándar).
 * - Escalón marginal: 2.3% sobre la parte del precio por encima de $20,000.
 * - Procesamiento Stripe: 2.9% + $0.30.
 * - La regalía y todas las tarifas se DEDUCEN del precio, no se suman encima:
 *   el comprador paga exactamente lo que se muestra.
 */
export const FEE = {
  service: 8,
  scaleRate: 0.023,
  scaleFrom: 20_000,
  stripePct: 0.029,
  stripeFlat: 0.3,
} as const

export type Quote = {
  price: number
  royalty: number
  buyerTotal: number
  service: number
  scale: number
  processing: number
  sellerNet: number
}

/** Desglose de una venta directa (Buy). */
export function quote(price: number, royaltyPct: number): Quote {
  const buyerTotal = price // lo mostrado es lo cobrado
  const royalty = price * (royaltyPct / 100)
  const scale = Math.max(0, price - FEE.scaleFrom) * FEE.scaleRate
  const processing = price * FEE.stripePct + FEE.stripeFlat
  const sellerNet = price - royalty - FEE.service - scale - processing
  return { price, royalty, buyerTotal, service: FEE.service, scale, processing, sellerNet }
}

export const XFER_FEE = 8

export type TransferQuote = {
  value: number
  royalty: number
  transferFee: number
  processing: number
  total: number
}

/**
 * Desglose de una transferencia. El emisor paga tarifa + procesamiento; si no
 * es el creador, también la regalía al creador. El valor en sí es procedencia
 * registrada en cadena, NO custodiado por la plataforma.
 */
export function transferQuote(value: number, royaltyPct: number, senderIsCreator: boolean): TransferQuote {
  const royalty = senderIsCreator ? 0 : value * (royaltyPct / 100)
  const processing = (royalty + XFER_FEE) * FEE.stripePct + FEE.stripeFlat
  const total = royalty + XFER_FEE + processing
  return { value, royalty, transferFee: XFER_FEE, processing, total }
}

/** Formato de dinero consistente con el prototipo (sin decimales para enteros). */
export function money(v: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
