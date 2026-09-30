import type { Rules } from '@/lib/rules-shape'
import type { EntityType } from '@/lib/seller'

/**
 * Por donde puede cobrar una persona — Work Order 02, Stage 7.2.
 *
 * Sale de `provider_countries`, la unica tabla de paises (059): banco donde
 * Connect llega; USDC donde esta listado, mientras `usdc_enabled` este
 * encendido, y solo para personas y trabajadores independientes (Stripe no paga
 * stablecoin a empresas). Lo usan la hoja de cobro, que ofrece, y la ruta de
 * cobro, que rechaza: las dos con la misma regla.
 */

export type RailProvider = 'stripe_connect_bank' | 'stripe_connect_stablecoin'

export type RailCountry = { payout_bank: boolean; payout_usdc: boolean; enabled: boolean } | null

export function railsFor(
  row: RailCountry,
  rules: Pick<Rules, 'payouts'>,
  entityType: EntityType | null
): RailProvider[] {
  if (!row || !row.enabled) return []
  const rails: RailProvider[] = []
  if (row.payout_bank) rails.push('stripe_connect_bank')
  const business = entityType === 'company' || entityType === 'institution'
  if (row.payout_usdc && rules.payouts.usdcEnabled && !business) rails.push('stripe_connect_stablecoin')
  return rails
}
