/**
 * Modelo de dinero — Backend Spec 01 §1 y §2 (7 ago 2026).
 * Fuente de verdad única para precios, regalías y tarifas en toda la app.
 *
 * Reemplaza el modelo anterior, en el que el comprador pagaba exactamente el
 * precio y el procesamiento se calculaba sobre el precio completo. Tres cambios:
 *
 *  - El comprador paga `precio + 8`. La tarifa de servicio se cobra en AMBOS
 *    lados: $8 al comprador y $8 descontados al vendedor, $16 por venta.
 *  - El procesamiento se calcula sobre `regalía + 8`, no sobre el precio, y lo
 *    absorbe solo el vendedor. Nunca se le suma al comprador.
 *  - Desaparece el escalón del 2.3% sobre la parte por encima de $20,000. Ese
 *    2.3% ahora es la comisión de cobro de payouts (§1.4).
 *
 * La regalía puede ser porcentaje o monto fijo. Una regalía fija es absoluta:
 * se debe completa sea cual sea el valor, incluso en una donación de valor cero.
 */

export const FEE = {
  /** Tarifa de servicio, cobrada a cada lado de una venta. */
  service: 8,
  stripePct: 0.029,
  stripeFlat: 0.3,
  /** Comisión de cobro de payout (§1.4), no de venta. */
  payoutRate: 0.023,
} as const

/**
 * La tarifa en centavos, que es como cobra Stripe.
 *
 * Deriva de `FEE.service` en vez de repetir el numero. El backend llevaba su
 * propio `pricing.ts` con 800 escrito aparte, y un mismo $8 con dos casas es
 * exactamente como una mitad del producto acaba cobrando lo que la otra no
 * muestra. Cuando las rutas de Stripe crucen, resuelven por aqui.
 */
export const SERVICE_FEE_CENTS = Math.round(FEE.service * 100)

/** Moneda de las tarifas de plataforma. */
export const PLATFORM_CURRENCY = 'usd' as const

export type RoyaltyType = 'none' | 'percentage' | 'fixed'

/** Los términos de regalía de una obra. `value` es el porcentaje o el monto. */
export type Royalty = { type: RoyaltyType; value: number }

/**
 * Resolución de regalía — §2.1. Ninguna ruta de dinero puede calcular
 * `valor × pct` por su cuenta: todas pasan por aquí.
 */
export function royaltyAmountOf(r: Royalty, value: number): number {
  if (r.type === 'none' || !r.value) return 0
  if (r.type === 'fixed') return r.value
  return value * (r.value / 100)
}

/**
 * Piso de precio para una regalía fija — §2.2. Sin él, un precio bajo dejaría
 * al vendedor pagando por vender. Se previene con el piso y no cobrándole la
 * diferencia: no hay pagos de faltante ni fondos retenidos.
 *
 * Los porcentajes no necesitan piso. Las transferencias tampoco lo llevan
 * (§2.3): ahí paga el emisor y ve el costo completo antes de confirmar.
 */
export function minPriceFor(r: Royalty): number {
  if (r.type !== 'fixed' || !r.value) return 0
  return r.value + Math.max(r.value * 0.05, 25)
}

export type Quote = {
  price: number
  royalty: number
  /** Lo que se le cobra al comprador: precio + tarifa de servicio. */
  buyerTotal: number
  service: number
  processing: number
  sellerNet: number
  /** Lo que recibe la plataforma: $8 de cada lado. */
  platformFee: number
}

/**
 * Desglose de una venta directa — §1.1.
 *
 * Cifras de referencia que esta función debe reproducir exactas:
 *
 *   precio  regalía   comprador  procesamiento   vendedor
 *   12,000  10% 1,200  12,008.00         35.33  10,756.67
 *   18,000  10% 1,800  18,008.00         52.73  16,139.27
 *   45,000  10% 4,500  45,008.00        131.03  40,360.97
 *    5,000  fija 1,200  5,008.00         35.33   3,756.67
 */
export function quote(price: number, r: Royalty): Quote {
  const royalty = royaltyAmountOf(r, price)
  const processing = (royalty + FEE.service) * FEE.stripePct + FEE.stripeFlat
  return {
    price,
    royalty,
    buyerTotal: price + FEE.service,
    service: FEE.service,
    processing,
    sellerNet: price - royalty - FEE.service - processing,
    platformFee: FEE.service * 2,
  }
}

export const XFER_FEE = FEE.service

export type TransferQuote = {
  value: number
  royalty: number
  transferFee: number
  processing: number
  total: number
}

/**
 * Desglose de una transferencia — §1.2. Paga el emisor; no hay comprador. El
 * valor en sí es procedencia registrada en cadena, NO custodiado por la
 * plataforma.
 *
 * Una transferencia puede valer cero. Con regalía porcentual la regalía es
 * entonces cero; con regalía fija se debe completa igual.
 */
export function transferQuote(value: number, r: Royalty, senderIsCreator: boolean): TransferQuote {
  const royalty = senderIsCreator ? 0 : royaltyAmountOf(r, value)
  const processing = (royalty + XFER_FEE) * FEE.stripePct + FEE.stripeFlat
  return { value, royalty, transferFee: XFER_FEE, processing, total: royalty + XFER_FEE + processing }
}

/** Lo que le queda al creador de una regalía — §1.3. El proveedor absorbe el procesamiento. */
export function royaltyPayout(royaltyAmount: number): number {
  return royaltyAmount - FEE.service
}

export type PayoutQuote = { gross: number; payoutFee: number; methodFee: number; net: number }

/**
 * Las tres comisiones que un método trae del registro (Área 2 §3.2). Vienen de
 * la fila, no de constantes: son política y se editan sin desplegar (§5.2).
 */
export type MethodFees = { platformPct: number; methodPct: number; methodFlat: number }

/** Comisión propia del rail — §5: `gross × method_pct + method_flat`. */
export function methodFeeOf(m: MethodFees, gross: number): number {
  return gross * m.methodPct + m.methodFlat
}

/**
 * Cobro de un bloque de payout — §1.4. `methodFee` sale del registro de métodos
 * de pago (Área 2 §3), que depende del país y del método.
 *
 * `platformPct` también viene del registro. El 2.3% de FEE.payoutRate es solo
 * el valor por defecto: el spec lo declara configurable por administración
 * (§5.2), así que una llamada que ya tiene la fila del método debe pasar el
 * suyo en vez de asumir la constante.
 */
export function payoutQuote(
  gross: number,
  methodFee: number,
  platformPct: number = FEE.payoutRate
): PayoutQuote {
  const payoutFee = gross * platformPct
  return { gross, payoutFee, methodFee, net: gross - payoutFee - methodFee }
}

/** Formato de dinero consistente con el prototipo (sin decimales para enteros). */
export function money(v: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Etiqueta de regalía — §2.4. Una regalía fija nunca muestra un porcentaje,
 * porque no aplica ninguno.
 */
export function royaltyLabel(r: Royalty, value: number, noneLabel: string): string {
  if (r.type === 'none' || !r.value) return noneLabel
  const amount = money(royaltyAmountOf(r, value))
  return r.type === 'fixed' ? `${amount} USD` : `${r.value}% · ${amount} USD`
}
