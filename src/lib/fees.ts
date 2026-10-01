import type { Rules } from '@/lib/rules-shape'

/**
 * Modelo de dinero — Backend Spec 01 §1 y §2, y Work Order 02 Stage 0.1, que
 * manda donde difieren. Fuente de verdad única para precios, regalías y
 * tarifas en toda la app.
 *
 *  - El comprador paga `precio + 8`. La tarifa de servicio se cobra en AMBOS
 *    lados: $8 al comprador y $8 descontados al vendedor, y $8 del lado de la
 *    regalía cuando la hay.
 *  - El procesamiento es 2.9% del cargo entero más $0.30 y lo absorbe el
 *    vendedor (0.1a). Nunca se le suma al comprador.
 *  - El 2.3% es la comisión de cobro de payouts (§1.4).
 *
 * La regalía puede ser porcentaje o monto fijo. Una regalía fija es absoluta:
 * se debe completa sea cual sea el valor, incluso en una donación de valor cero.
 */

/**
 * La tarifa de tarjeta de Stripe: lo unico que se queda en codigo (Work Order
 * 02, §3 «Never in configuration»). Es de Stripe, no nuestra.
 *
 * Todo lo demas —las tarifas de servicio, el piso, el porcentaje de payout—
 * vive en `platform_config` y llega aqui como `FeeRules`, leido por
 * `getRules()` en el servidor o `useRules()` en el navegador. Un mismo $8 con
 * dos casas es exactamente como una mitad del producto acaba cobrando lo que la
 * otra no muestra.
 */
export const FEE = {
  stripePct: 0.029,
  stripeFlat: 0.3,
} as const

/**
 * La tarifa de tarjeta, para mostrarla: el panel y el asistente la leen de aqui
 * y no la escriben a mano (Work Order 02, check:money).
 */
export const PROCESSING_PCT = FEE.stripePct * 100
export const PROCESSING_RULE = `${PROCESSING_PCT}% x charge + $${FEE.stripeFlat.toFixed(2)}`

/** Lo que estas funciones necesitan de las reglas. `Rules` lo cumple entero. */
export type FeeRules = Pick<Rules, 'fees' | 'royalty'>

/** Un monto en dolares, en centavos, que es como cobra Stripe. */
export const cents = (usd: number): number => Math.round(usd * 100)

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
/**
 * El piso que una regalia fija le pone a la obra (D-8): la regalia mas el mayor
 * entre `royalty_floor_pct` de la regalia y `royalty_floor_min`. De
 * configuracion: el asistente y la pagina lo leen de la misma fila.
 */
export function minPriceFor(r: Royalty, rules: Pick<Rules, 'royalty'>): number {
  if (r.type !== 'fixed' || !r.value) return 0
  return r.value + Math.max(r.value * (rules.royalty.floorPct / 100), rules.royalty.floorMin)
}

/** La via de cobro de una venta (Work Order 02, 0.3 y 0.4). */
export type ChargePath = 'direct' | 'platform'

export type SaleQuote = {
  path: ChargePath
  price: number
  /** Lo que paga el comprador: precio + tarifa de servicio del comprador. Es el cargo. */
  buyerTotal: number
  charge: number
  serviceBuyer: number
  serviceSeller: number
  /** 2.9% x cargo + $0.30, redondeado hacia arriba desde medio centavo. */
  processing: number
  royaltyGross: number
  /** La regalia menos la tarifa del lado de la regalia; nunca negativa. */
  royaltyEarning: number
  /** Las tarifas de servicio que se queda tbt.cafe: $8 + $8, y $8 de la regalia si la hay. */
  platformTake: number
  sellerNet: number
  /** Solo en la via directa (0.1b): regalia + las dos tarifas + procesamiento. */
  applicationFee: number | null
}

/**
 * El desglose de una venta — Work Order 02, Stage 0.1. La unica aritmetica de
 * una venta: ninguna ruta calcula una tarifa por su cuenta.
 *
 * Todo en centavos enteros, para que redondear y cuadrar sean exactos:
 * comprador = vendedor + regalia neta + plataforma + procesamiento, siempre.
 *
 * Via directa: el cargo se hace en la cuenta del vendedor y la plataforma cobra
 * `applicationFee` (0.1b); el procesamiento va dentro, porque Stripe se lo
 * factura a la plataforma (fees_collector: 'application'). Via plataforma: el
 * cargo entero cae en tbt.cafe y el neto del vendedor se vuelve una ganancia
 * de venta (0.4b); las cifras son las mismas, sin app fee.
 *
 * Filas de referencia (0.1d), que check:fees reproduce al centavo:
 *
 *   precio  regalia     comprador  procesamiento  regalia neta  plataforma  vendedor   app fee
 *   12,000  10% 1,200   12,008.00         348.53      1,192.00       24.00  10,443.47  1,564.53
 *   18,000  10% 1,800   18,008.00         522.53      1,792.00       24.00  15,669.47  2,338.53
 *   45,000  10% 4,500   45,008.00       1,305.53      4,492.00       24.00  39,186.47  5,821.53
 *    5,000  fija 1,200   5,008.00         145.53      1,192.00       24.00   3,646.47  1,361.53
 *    2,000  sin regalia  2,008.00          58.53             —       16.00   1,933.47     74.53
 */
export function saleQuote(input: { price: number; royalty: Royalty; path: ChargePath }, rules: Pick<Rules, 'fees'>): SaleQuote {
  const priceC = cents(input.price)
  const buyerC = cents(rules.fees.serviceBuyer)
  const sellerC = cents(rules.fees.serviceSeller)
  const chargeC = priceC + buyerC
  // 2.9% x cargo + 30 centavos, medio centavo hacia arriba, en enteros.
  const processingC = Math.floor((chargeC * 29 + 30_000 + 500) / 1000)
  const royaltyC = cents(royaltyAmountOf(input.royalty, input.price))
  const royaltySideC = Math.min(cents(rules.fees.serviceRoyalty), royaltyC)
  const royaltyEarningC = royaltyC - royaltySideC
  const platformC = buyerC + sellerC + royaltySideC
  const sellerNetC = priceC - royaltyC - sellerC - processingC
  const d = (c: number) => c / 100
  return {
    path: input.path,
    price: d(priceC),
    buyerTotal: d(chargeC),
    charge: d(chargeC),
    serviceBuyer: d(buyerC),
    serviceSeller: d(sellerC),
    processing: d(processingC),
    royaltyGross: d(royaltyC),
    royaltyEarning: d(royaltyEarningC),
    platformTake: d(platformC),
    sellerNet: d(sellerNetC),
    applicationFee: input.path === 'direct' ? d(royaltyC + buyerC + sellerC + processingC) : null,
  }
}

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
export function transferQuote(value: number, r: Royalty, senderIsCreator: boolean, rules: Pick<Rules, 'fees'>): TransferQuote {
  const royalty = senderIsCreator ? 0 : royaltyAmountOf(r, value)
  const transferFee = rules.fees.transfer
  const processing = (royalty + transferFee) * FEE.stripePct + FEE.stripeFlat
  return { value, royalty, transferFee, processing, total: royalty + transferFee + processing }
}

/** Lo que le queda al creador de una regalía — §1.3. El proveedor absorbe el procesamiento. */
export function royaltyPayout(royaltyAmount: number, rules: Pick<Rules, 'fees'>): number {
  return royaltyAmount - rules.fees.serviceRoyalty
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
 * `platformPct` también viene del registro o de `payout_platform_pct`; ya no
 * hay un valor por defecto en codigo (Work Order 02, 1.2).
 */
export function payoutQuote(
  gross: number,
  methodFee: number,
  platformPct: number
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
