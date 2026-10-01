import { money } from '@/lib/fees'
import type { Rules } from '@/lib/rules-shape'

/**
 * La prosa sigue a los valores — Work Order 02, Stage 1.4.
 *
 * Donde el Roast, los Terminos, un correo o una cadena de la interfaz dicen un
 * numero que esta orden configura, el texto lleva un marcador y el numero sale
 * de la fila. Los nombres son los del texto aprobado (companion Set 5):
 * `{hours}`, `{standard}`, `{high_threshold}`… para que ese texto entre tal
 * cual cuando llegue el 13.2.
 *
 * Solo se sustituyen los nombres de aqui. Cualquier otra llave — `{amount}`,
 * `{name}` en las cadenas de i18n — pasa intacta a quien la rellena.
 */
export function proseValues(rules: Rules): Record<string, string> {
  return {
    hours: String(rules.transferWindowHours),
    fee: money(rules.fees.registration),
    service_fee: money(rules.fees.serviceBuyer),
    seller_fee: money(rules.fees.serviceSeller),
    transfer_fee: money(rules.fees.transfer),
    floor_pct: `${money(rules.royalty.floorPct)}%`,
    floor_min: money(rules.royalty.floorMin),
    royalty_ceiling: `${money(rules.royalty.pctCeiling)}%`,
    biometric: money(rules.biometricThreshold),
    payout_pct: `${money(rules.payouts.platformPct * 100)}%`,
    standard: String(rules.settlement.daysStandard),
    high: String(rules.settlement.daysHigh),
    high_threshold: money(rules.settlement.highThreshold),
    top: String(rules.settlement.daysTop),
    top_threshold: money(rules.settlement.topThreshold),
    hold: String(rules.settlement.firstPayoutHoldDays),
    offer_max_hours: String(rules.offers.maxHours),
    offer_payment_hours: String(rules.offers.paymentWindowHours),
    covered: String(rules.covered.count),
  }
}

/** Los marcadores que existen. check:prose comprueba que coinciden con `proseValues`. */
export const PROSE_NAMES = [
  'hours', 'fee', 'service_fee', 'seller_fee', 'transfer_fee', 'floor_pct', 'floor_min', 'royalty_ceiling',
  'biometric', 'payout_pct', 'standard', 'high', 'high_threshold', 'top', 'top_threshold', 'hold',
  'offer_max_hours', 'offer_payment_hours', 'covered',
] as const

const TOKEN = /\{([a-z_]+)\}/g

/** El texto con cada marcador conocido sustituido. Los demas quedan como estaban. */
export function fillProse(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (whole, name: string) => (name in values ? values[name] : whole))
}

/** Lo mismo sobre cualquier estructura de texto (bloques del Roast, secciones legales). */
export function fillDeep<T>(value: T, values: Record<string, string>): T {
  if (typeof value === 'string') return fillProse(value, values) as unknown as T
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, values)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = fillDeep(v, values)
    return out as T
  }
  return value
}
