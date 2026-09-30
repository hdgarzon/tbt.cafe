import type { Rules } from '@/lib/rules-shape'

/**
 * El estado de vendedor — Work Order 02, Stage 2.
 *
 * Un solo sitio para la regla (M8): una solicitud se acepta solo si el pais
 * tiene al menos un rail de cobro; la via es directa donde una cuenta completa
 * puede cobrar y de plataforma en el resto. El vendedor nunca la elige.
 */

export type SellerStatus = 'not_applied' | 'pending' | 'declined' | 'active' | 'paused_self'
export type EntityType = 'individual' | 'sole_proprietor' | 'company' | 'institution'
export type ChargePath = 'direct' | 'platform'

export type SellerRow = {
  user_id: string
  status: SellerStatus
  suspended_at: string | null
  suspended_reason: string | null
  country: string | null
  charge_path: ChargePath | null
  entity_type: EntityType | null
  declined_reason: string | null
  remembered_listings: string[]
}

export type ProviderCountry = {
  country: string
  merchant: boolean
  payout_bank: boolean
  payout_usdc: boolean
  enabled: boolean
}

export const ENTITY_TYPES: EntityType[] = ['individual', 'sole_proprietor', 'company', 'institution']

/** La via de cobro: sale solo de `provider_countries` (2.3). */
export function pathFor(row: Pick<ProviderCountry, 'merchant'>): ChargePath {
  return row.merchant ? 'direct' : 'platform'
}

/**
 * Si el pais tiene algun rail de cobro. USDC cuenta solo mientras
 * `usdc_enabled` este encendido: la aprobacion de Stripe es un cambio de
 * configuracion, no un despliegue (§3, M22).
 */
export function coverageFor(row: ProviderCountry | null, rules: Pick<Rules, 'payouts'>): boolean {
  if (!row || !row.enabled) return false
  return row.payout_bank || (row.payout_usdc && rules.payouts.usdcEnabled)
}

/** Puede vender: activo y sin suspension. Pausarse uno mismo no es vender. */
export function canSell(seller: Pick<SellerRow, 'status' | 'suspended_at'> | null): boolean {
  if (!seller) return false
  return seller.status === 'active' && !seller.suspended_at
}
