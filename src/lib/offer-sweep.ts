import type { SupabaseClient } from '@supabase/supabase-js'
import { getRules } from '@/lib/rules'
import { notify } from '@/lib/notify'
import { canSell, type SellerRow } from '@/lib/seller'
import { cancelUnpaid } from '@/lib/offers-server'

/**
 * Los relojes de las ofertas — Work Order 02, Stage 4.6 y 4.7.
 *
 * Idempotente: cada recordatorio se marca en su columna y cada aviso lleva su
 * dedupeKey, asi que correrlo dos veces no manda nada dos veces. Lo programa
 * el barrido del Stage 6 (Supabase Cron); aqui no se programa nada.
 *
 *  - A mitad de la duracion, y cuando queda `offer_near_expiry_fraction` de
 *    ella, recuerda a los dos.
 *  - Al `expires_at` vence la oferta abierta y avisa a los dos. Si quien tiene
 *    la obra no estaba aprobado para vender, lo anota: al aprobarlo se avisa
 *    a esos compradores (4.10).
 *  - A la cancelacion automatica, cancela la aceptada sin pagar.
 */

/** El enlace de un aviso abre la hoja de la oferta en el hub (4.12). */
const sheetOf = (offerId: string) => `/?offer=${offerId}`
const BATCH = 200

type Live = {
  id: string
  work_id: string
  from_user: string
  status: string
  duration_hours: number
  expires_at: string
  created_at: string
  auto_cancel_at: string | null
  halfway_reminded_at: string | null
  near_reminded_at: string | null
  work: { title: string | null; current_owner_id: string } | { title: string | null; current_owner_id: string }[] | null
}

export async function sweepOffers(db: SupabaseClient, now = new Date()) {
  const rules = await getRules()
  const { data } = await db
    .from('offers')
    .select('id, work_id, from_user, status, duration_hours, expires_at, created_at, auto_cancel_at, halfway_reminded_at, near_reminded_at, work:works(title, current_owner_id)')
    .in('status', ['open', 'accepted'])
    .order('expires_at', { ascending: true })
    .limit(BATCH)

  const result = { reminded: 0, expired: 0, cancelled: 0 }
  const iso = now.toISOString()

  for (const o of (data ?? []) as Live[]) {
    const work = Array.isArray(o.work) ? o.work[0] : o.work
    if (!work) continue
    const title = work.title ?? ''
    const both = [o.from_user, work.current_owner_id]

    if (o.status === 'accepted') {
      if (o.auto_cancel_at && new Date(o.auto_cancel_at) <= now) {
        await cancelUnpaid(db, o, work, 'auto_cancel', null)
        result.cancelled++
      }
      continue
    }

    const created = new Date(o.created_at).getTime()
    const expires = new Date(o.expires_at).getTime()
    const duration = o.duration_hours * 3_600_000

    if (expires <= now.getTime()) {
      const { data: holder } = await db.from('seller_accounts').select('status, suspended_at').eq('user_id', work.current_owner_id).maybeSingle()
      const reason = canSell(holder as Pick<SellerRow, 'status' | 'suspended_at'> | null) ? 'expired' : 'expired_unapproved'
      const { data: changed } = await db
        .from('offers')
        .update({ status: 'expired', closed_at: iso, close_reason: reason, suspended: false })
        .eq('id', o.id)
        .eq('status', 'open')
        .select('id')
      if (!changed?.length) continue
      await db.from('offer_events').insert({ offer_id: o.id, event: 'expired', detail: { reason } })
      for (let i = 0; i < both.length; i++) {
        await notify(db, { userId: both[i], eventKey: 'offer_expired', dedupeKey: `offer:${o.id}:expired:${i}`, data: { title, offerId: o.id }, href: sheetOf(o.id) })
      }
      result.expired++
      continue
    }

    const left = expires - now.getTime()
    const hoursLeft = String(Math.max(1, Math.round(left / 3_600_000)))
    const halfway = !o.halfway_reminded_at && now.getTime() >= created + duration / 2
    const near = !o.near_reminded_at && left <= duration * rules.offers.nearExpiryFraction
    if (!halfway && !near) continue

    const column = near ? 'near_reminded_at' : 'halfway_reminded_at'
    const { data: marked } = await db.from('offers').update({ [column]: iso }).eq('id', o.id).is(column, null).select('id')
    if (!marked?.length) continue
    for (let i = 0; i < both.length; i++) {
      await notify(db, {
        userId: both[i],
        eventKey: 'offer_expiring',
        dedupeKey: `offer:${o.id}:${column}:${i}`,
        data: { title, time: `${hoursLeft} h`, offerId: o.id },
        href: sheetOf(o.id),
      })
    }
    result.reminded++
  }
  return result
}
