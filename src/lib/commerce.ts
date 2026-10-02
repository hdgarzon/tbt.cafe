import { minPriceFor, type Royalty, type RoyaltyType } from '@/lib/fees'
import { canSell, type SellerRow } from '@/lib/seller'
import type { Rules } from '@/lib/rules-shape'

/**
 * Lo que el dueno puede cambiar de su obra — Work Order 02, Stage 3.1.
 *
 * Puro: recibe la fila, el pedido y las reglas, y devuelve la escritura o el
 * motivo del rechazo. La ruta solo lee, llama aqui y escribe. La base hace
 * cumplir lo mismo por su cuenta (059, 060): esto es para responder con el
 * motivo, no la unica defensa.
 */

export type Availability = 'for_sale' | 'reserved' | 'not_for_sale'

export type CommerceRow = {
  availability: Availability
  initial_price: number | null
  taking_offers: boolean
  royalty_type: RoyaltyType | null
  royalty_value: number | null
  royalty_locked: boolean
  frozen_offer_id: string | null
}

export type CommercePatch = {
  availability?: Availability
  price?: number
  takingOffers?: boolean
  royalty?: { type: 'percentage' | 'fixed'; value: number }
}

export type CommercePlan =
  | { ok: true; update: Record<string, unknown>; priceLifted: number | null }
  | { ok: false; error: 'frozen' | 'royalty_locked' | 'above_ceiling' | 'invalid' | 'seller_not_active' | 'selling_paused' }

const AVAILABILITY: Availability[] = ['for_sale', 'reserved', 'not_for_sale']

export function planCommerce(
  row: CommerceRow,
  patch: CommercePatch,
  rules: Pick<Rules, 'royalty' | 'pauses'>,
  seller: Pick<SellerRow, 'status' | 'suspended_at'> | null
): CommercePlan {
  // 3.6: mientras una oferta aceptada la tiene congelada, nada cambia.
  if (row.frozen_offer_id) return { ok: false, error: 'frozen' }

  const update: Record<string, unknown> = {}

  if (patch.availability !== undefined) {
    if (AVAILABILITY.indexOf(patch.availability) === -1) return { ok: false, error: 'invalid' }
    if (patch.availability === 'for_sale' && row.availability !== 'for_sale') {
      if (rules.pauses.selling.on) return { ok: false, error: 'selling_paused' }
      if (!canSell(seller)) return { ok: false, error: 'seller_not_active' }
    }
    update.availability = patch.availability
  }

  if (patch.takingOffers !== undefined) update.taking_offers = patch.takingOffers === true

  let royalty: Royalty = { type: (row.royalty_type ?? 'none') as Royalty['type'], value: Number(row.royalty_value ?? 0) }
  if (patch.royalty) {
    if (row.royalty_locked) return { ok: false, error: 'royalty_locked' }
    const { type, value } = patch.royalty
    if ((type !== 'percentage' && type !== 'fixed') || !Number.isFinite(value) || value < 0) return { ok: false, error: 'invalid' }
    if (type === 'percentage' && value > rules.royalty.pctCeiling) return { ok: false, error: 'above_ceiling' }
    royalty = { type, value }
    update.royalty_type = type
    update.royalty_value = value
  }

  // El precio: el pedido, o el que ya tiene si solo cambio la regalia.
  let price = row.initial_price === null ? null : Number(row.initial_price)
  if (patch.price !== undefined) {
    if (!Number.isFinite(patch.price) || patch.price < 0) return { ok: false, error: 'invalid' }
    price = patch.price
    update.initial_price = price
  }

  // 3.5, Registry §1: una regalia fija cuyo piso el precio no cubre sube el
  // precio al piso en vez de rechazarse. Subir la regalia fija sube el precio.
  let priceLifted: number | null = null
  const floor = minPriceFor(royalty, rules)
  if (floor > 0 && price !== null && price < floor) {
    priceLifted = floor
    update.initial_price = floor
  }

  return { ok: true, update, priceLifted }
}
