import { minPriceFor, type Royalty, type RoyaltyType } from '@/lib/fees'
import type { Rules } from '@/lib/rules-shape'

/**
 * Las reglas de una oferta — Work Order 02, Stage 4.
 *
 * Puro, para que el navegador (que avisa antes de enviar) y el servidor (que
 * decide) digan lo mismo. Las escrituras viven en `offers-server.ts`.
 */

export type OfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'cancelled' | 'completed'

export const DURATIONS = [24, 48, 72] as const
export const DEFAULT_DURATION = 72

/** Las duraciones que se ofrecen: nunca por encima de `offer_max_hours`. */
export function durationsFor(rules: Pick<Rules, 'offers'>): number[] {
  return DURATIONS.filter((d) => d <= rules.offers.maxHours)
}

/** Texto plano: sin caracteres de control, sin espacios sobrantes. */
export function cleanMessage(text: unknown): string | null {
  if (typeof text !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  return clean ? clean : null
}

export type OfferInput = { amount: unknown; durationHours?: unknown; message?: unknown }
export type OfferCommerce = { taking_offers: boolean; royalty_type: RoyaltyType | null; royalty_value: number | null }

export type OfferPlan =
  | { ok: true; amount: number; durationHours: number; message: string | null }
  | {
      ok: false
      error: 'is_holder' | 'not_taking_offers' | 'offers_paused' | 'invalid_amount' | 'below_floor' | 'invalid_duration' | 'message_too_long'
      floor?: number
    }

export function planOffer(
  input: OfferInput,
  ctx: { commerce: OfferCommerce; isHolder: boolean; rules: Pick<Rules, 'offers' | 'royalty' | 'pauses'> }
): OfferPlan {
  if (ctx.isHolder) return { ok: false, error: 'is_holder' }
  // 4.8: sin tomar ofertas no entran nuevas; las que hay siguen su curso.
  if (!ctx.commerce.taking_offers) return { ok: false, error: 'not_taking_offers' }
  if (ctx.rules.pauses.offers.on) return { ok: false, error: 'offers_paused' }

  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid_amount' }
  const royalty: Royalty = { type: (ctx.commerce.royalty_type ?? 'none') as Royalty['type'], value: Number(ctx.commerce.royalty_value ?? 0) }
  const floor = minPriceFor(royalty, ctx.rules)
  if (floor > 0 && amount < floor) return { ok: false, error: 'below_floor', floor }

  const durationHours = input.durationHours === undefined ? Math.min(DEFAULT_DURATION, ctx.rules.offers.maxHours) : Number(input.durationHours)
  if (durationsFor(ctx.rules).indexOf(durationHours) === -1) return { ok: false, error: 'invalid_duration' }

  const message = cleanMessage(input.message)
  if (message && message.length > ctx.rules.offers.messageMax) return { ok: false, error: 'message_too_long' }

  return { ok: true, amount: Math.round(amount * 100) / 100, durationHours, message }
}
