import { rulesFromRow, type Rules } from '../src/lib/rules-shape'

/**
 * Reglas de prueba para las guardas: los valores por defecto de la migracion
 * 058, pasados por la misma conversion que usa la aplicacion. Las guardas no
 * leen la base; comprueban la aritmetica con reglas que ellas mismas fijan.
 */
export const DEFAULT_ROW: Record<string, unknown> = {
  covered_brews_enabled: true, covered_brews_count: 10,
  service_fee_buyer: 8, service_fee_seller: 8, service_fee_royalty: 8, registration_fee: 8, transfer_fee: 8,
  settlement_days_standard: 7, settlement_days_high: 14, settlement_high_threshold: 1000,
  settlement_days_top: 30, settlement_top_threshold: 10000,
  first_payout_hold_days: 30, first_payout_clean_sales: 2, first_payout_max_days: 90,
  absorption_threshold: 250, writeoff_months: 24,
  royalty_pct_ceiling: 90, royalty_pct_warning: 50, royalty_floor_pct: 10, royalty_floor_min: 50,
  transfer_window_hours: 48,
  offer_max_hours: 72, offer_payment_window_hours: 24, offer_auto_cancel_days: 4,
  offer_near_expiry_fraction: 0.1, offer_message_max: 500,
  title_link_days: 30, title_link_warning_day: 25,
  velocity_count_per_hour: 3, velocity_outbound_24h: 25000, velocity_new_pair_days: 30, velocity_new_pair_threshold: 5000,
  phone_change_days: 30, biometric_threshold: 500, three_ds_registration_exempt: true,
  payout_platform_pct: 0.023, payout_cost_bank: 1.5, payout_cost_usdc: 1, seller_payout_delay_days: 7, usdc_enabled: false,
  scan_warn: 0.75, scan_block: 0.9, scan_processor_url: 'https://scanner.example.com',
}

export function testRules(overrides: Record<string, unknown> = {}): Rules {
  return rulesFromRow({ ...DEFAULT_ROW, ...overrides })
}
