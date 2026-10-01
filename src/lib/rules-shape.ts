/**
 * La forma de las reglas — Work Order 02, §3.
 *
 * Sin dependencias: la usan el lector del servidor (`rules.ts`) y el del
 * navegador (`rules-public.ts`). Aqui viven el tipo, la conversion desde la
 * fila y la autoridad de cada valor, que la ruta de configuracion hace cumplir
 * (Stage 1.5): «two-person» cambia lo que alguien paga.
 */

export type Locale4 = { en: string; es: string; pt: string; fr: string }
export type PauseKey = 'registration' | 'selling' | 'offers' | 'transfers' | 'payouts'

export type Rules = {
  fees: {
    serviceBuyer: number
    serviceSeller: number
    serviceRoyalty: number
    registration: number
    transfer: number
  }
  settlement: {
    daysStandard: number
    daysHigh: number
    highThreshold: number
    daysTop: number
    topThreshold: number
    firstPayoutHoldDays: number
    firstPayoutCleanSales: number
    firstPayoutMaxDays: number
    absorptionThreshold: number
    writeoffMonths: number
  }
  royalty: { pctCeiling: number; pctWarning: number; floorPct: number; floorMin: number }
  transferWindowHours: number
  offers: {
    maxHours: number
    paymentWindowHours: number
    autoCancelDays: number
    nearExpiryFraction: number
    messageMax: number
  }
  titleLink: { days: number; warningDay: number }
  velocity: { countPerHour: number; outbound24h: number; newPairDays: number; newPairThreshold: number }
  phoneChangeDays: number
  biometricThreshold: number
  threeDsRegistrationExempt: boolean
  payouts: { platformPct: number; costBank: number; costUsdc: number; sellerDelayDays: number; usdcEnabled: boolean }
  scan: { warn: number; block: number }
  /** Solo en el servidor: `rules-public.ts` no la pide y el navegador no puede leerla (058). */
  scanProcessorUrl: string | null
  pauses: Record<PauseKey, { on: boolean; message: Locale4 }>
  /** El programa de registraciones cubiertas (011): ya vivia en esta fila. */
  covered: { enabled: boolean; count: number }
  /** Chains 01 7.2: los umbrales del saldo del payer (075). */
  balance: { warningDays: number; urgentDays: number; warningFloorSol: number; urgentFloorSol: number }
}

/**
 * Las columnas que la clave publica puede leer (058): todas menos la direccion
 * del escaner. Se piden por nombre; un `select('*')` fallaria entero.
 */
export function publicRuleColumns(): string {
  return ['id', ...Object.keys(RULE_AUTHORITY).filter((c) => c !== 'scan_processor_url')].join(', ')
}

/** La ventana para aceptar una transferencia, en milisegundos (M13). */
export function transferWindowMs(rules: Pick<Rules, 'transferWindowHours'>): number {
  return rules.transferWindowHours * 3_600_000
}

/** La fila tal como la devuelve Supabase. Los numeric llegan como string. */
export type RulesRow = Record<string, unknown>

const num = (row: RulesRow, col: string): number => {
  const v = Number(row[col])
  if (!Number.isFinite(v)) throw new Error(`rules: ${col} is not a number`)
  return v
}
const bool = (row: RulesRow, col: string): boolean => row[col] === true
const msg = (row: RulesRow, col: string): Locale4 => {
  const m = (row[col] ?? {}) as Partial<Locale4>
  return { en: m.en ?? '', es: m.es ?? '', pt: m.pt ?? '', fr: m.fr ?? '' }
}

const PAUSE_KEYS: PauseKey[] = ['registration', 'selling', 'offers', 'transfers', 'payouts']

export function rulesFromRow(row: RulesRow): Rules {
  const pauses = {} as Rules['pauses']
  for (let i = 0; i < PAUSE_KEYS.length; i++) {
    const k = PAUSE_KEYS[i]
    pauses[k] = { on: bool(row, `pause_${k}`), message: msg(row, `pause_${k}_message`) }
  }
  return {
    fees: {
      serviceBuyer: num(row, 'service_fee_buyer'),
      serviceSeller: num(row, 'service_fee_seller'),
      serviceRoyalty: num(row, 'service_fee_royalty'),
      registration: num(row, 'registration_fee'),
      transfer: num(row, 'transfer_fee'),
    },
    settlement: {
      daysStandard: num(row, 'settlement_days_standard'),
      daysHigh: num(row, 'settlement_days_high'),
      highThreshold: num(row, 'settlement_high_threshold'),
      daysTop: num(row, 'settlement_days_top'),
      topThreshold: num(row, 'settlement_top_threshold'),
      firstPayoutHoldDays: num(row, 'first_payout_hold_days'),
      firstPayoutCleanSales: num(row, 'first_payout_clean_sales'),
      firstPayoutMaxDays: num(row, 'first_payout_max_days'),
      absorptionThreshold: num(row, 'absorption_threshold'),
      writeoffMonths: num(row, 'writeoff_months'),
    },
    royalty: {
      pctCeiling: num(row, 'royalty_pct_ceiling'),
      pctWarning: num(row, 'royalty_pct_warning'),
      floorPct: num(row, 'royalty_floor_pct'),
      floorMin: num(row, 'royalty_floor_min'),
    },
    transferWindowHours: num(row, 'transfer_window_hours'),
    offers: {
      maxHours: num(row, 'offer_max_hours'),
      paymentWindowHours: num(row, 'offer_payment_window_hours'),
      autoCancelDays: num(row, 'offer_auto_cancel_days'),
      nearExpiryFraction: num(row, 'offer_near_expiry_fraction'),
      messageMax: num(row, 'offer_message_max'),
    },
    titleLink: { days: num(row, 'title_link_days'), warningDay: num(row, 'title_link_warning_day') },
    velocity: {
      countPerHour: num(row, 'velocity_count_per_hour'),
      outbound24h: num(row, 'velocity_outbound_24h'),
      newPairDays: num(row, 'velocity_new_pair_days'),
      newPairThreshold: num(row, 'velocity_new_pair_threshold'),
    },
    phoneChangeDays: num(row, 'phone_change_days'),
    biometricThreshold: num(row, 'biometric_threshold'),
    threeDsRegistrationExempt: bool(row, 'three_ds_registration_exempt'),
    payouts: {
      platformPct: num(row, 'payout_platform_pct'),
      costBank: num(row, 'payout_cost_bank'),
      costUsdc: num(row, 'payout_cost_usdc'),
      sellerDelayDays: num(row, 'seller_payout_delay_days'),
      usdcEnabled: bool(row, 'usdc_enabled'),
    },
    scan: { warn: num(row, 'scan_warn'), block: num(row, 'scan_block') },
    scanProcessorUrl: typeof row.scan_processor_url === 'string' ? row.scan_processor_url : null,
    pauses,
    covered: { enabled: bool(row, 'covered_brews_enabled'), count: num(row, 'covered_brews_count') },
    balance: {
      warningDays: num(row, 'balance_warning_days'),
      urgentDays: num(row, 'balance_urgent_days'),
      warningFloorSol: num(row, 'balance_warning_floor_sol'),
      urgentFloorSol: num(row, 'balance_urgent_floor_sol'),
    },
  }
}

/**
 * Quien puede cambiar cada columna (§3). Lo que no esta aqui no se edita desde
 * el panel. Las promesas no estan, ni desactivadas: viven en codigo.
 */
export const RULE_AUTHORITY: Record<string, 'two_person' | 'operator'> = {
  covered_brews_enabled: 'two_person',
  covered_brews_count: 'two_person',
  service_fee_buyer: 'two_person',
  service_fee_seller: 'two_person',
  service_fee_royalty: 'two_person',
  registration_fee: 'two_person',
  transfer_fee: 'two_person',
  settlement_days_standard: 'operator',
  settlement_days_high: 'operator',
  settlement_high_threshold: 'operator',
  settlement_days_top: 'operator',
  settlement_top_threshold: 'operator',
  first_payout_hold_days: 'operator',
  first_payout_clean_sales: 'operator',
  first_payout_max_days: 'operator',
  absorption_threshold: 'operator',
  writeoff_months: 'operator',
  royalty_pct_ceiling: 'two_person',
  royalty_pct_warning: 'two_person',
  royalty_floor_pct: 'two_person',
  royalty_floor_min: 'two_person',
  transfer_window_hours: 'operator',
  offer_max_hours: 'operator',
  offer_payment_window_hours: 'operator',
  offer_auto_cancel_days: 'operator',
  offer_near_expiry_fraction: 'operator',
  offer_message_max: 'operator',
  title_link_days: 'operator',
  title_link_warning_day: 'operator',
  velocity_count_per_hour: 'operator',
  velocity_outbound_24h: 'operator',
  velocity_new_pair_days: 'operator',
  velocity_new_pair_threshold: 'operator',
  phone_change_days: 'operator',
  biometric_threshold: 'two_person',
  three_ds_registration_exempt: 'two_person',
  payout_platform_pct: 'two_person',
  payout_cost_bank: 'operator',
  payout_cost_usdc: 'operator',
  seller_payout_delay_days: 'operator',
  usdc_enabled: 'operator',
  scan_warn: 'two_person',
  scan_block: 'two_person',
  scan_processor_url: 'operator',
  pause_registration: 'operator',
  pause_registration_message: 'operator',
  pause_selling: 'operator',
  pause_selling_message: 'operator',
  pause_offers: 'operator',
  pause_offers_message: 'operator',
  pause_transfers: 'operator',
  pause_transfers_message: 'operator',
  pause_payouts: 'operator',
  pause_payouts_message: 'operator',
  balance_warning_days: 'operator',
  balance_urgent_days: 'operator',
  balance_warning_floor_sol: 'operator',
  balance_urgent_floor_sol: 'operator',
}
