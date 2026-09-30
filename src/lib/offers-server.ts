import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase-admin'
import { getRules } from '@/lib/rules'
import { notify } from '@/lib/notify'
import { money } from '@/lib/fees'
import { canSell, coverageFor, type ProviderCountry, type SellerRow } from '@/lib/seller'
import { planOffer, cleanMessage, type OfferCommerce, type OfferInput } from '@/lib/offers'

/**
 * Las escrituras de ofertas — Work Order 02, Stage 4.
 *
 * El unico modulo que cambia `offers` (check:offers): las rutas y el barrido
 * llaman aqui. Cada cambio deja un evento en `offer_events`, que nadie edita.
 *
 * Los avisos nunca llevan el texto de un mensaje (4.11): dicen que hay uno y
 * llevan al hub.
 */

type OfferRow = {
  id: string
  work_id: string
  from_user: string
  amount: number
  status: string
  duration_hours: number
  expires_at: string
  message: string | null
  response_message: string | null
  payment_due_at: string | null
  suspended: boolean
  created_at: string
}

const OFFER_COLUMNS =
  'id, work_id, from_user, amount, status, duration_hours, expires_at, message, response_message, payment_due_at, suspended, created_at'

/** El enlace de un aviso abre la hoja de la oferta en el hub (4.12). */
const sheetOf = (offerId: string) => `/?offer=${offerId}`

async function logEvent(db: SupabaseClient, offerId: string, event: string, actorId: string | null, detail: Record<string, unknown> = {}) {
  await db.from('offer_events').insert({ offer_id: offerId, event, actor_id: actorId, detail })
}

async function workOf(db: SupabaseClient, workId: string) {
  const { data } = await db.from('works').select('id, title, current_owner_id').eq('id', workId).maybeSingle()
  return data as { id: string; title: string | null; current_owner_id: string } | null
}

async function sellerOf(db: SupabaseClient, userId: string) {
  const { data } = await db.from('seller_accounts').select('status, suspended_at, country').eq('user_id', userId).maybeSingle()
  return data as (Pick<SellerRow, 'status' | 'suspended_at' | 'country'>) | null
}

/** Lo que el navegador necesita saber antes de enviar (4.2): S-2 o no cubierto. */
export async function offerContext(workId: string) {
  const db = createAdminClient()
  const [work, rules] = await Promise.all([workOf(db, workId), getRules()])
  if (!work) return null
  const seller = await sellerOf(db, work.current_owner_id)
  let covered = true
  if (seller?.country) {
    const { data: row } = await db.from('provider_countries').select('country, merchant, payout_bank, payout_usdc, enabled').eq('country', seller.country).maybeSingle()
    covered = coverageFor(row as ProviderCountry | null, rules)
  }
  // Mientras una oferta aceptada espera el pago, la obra esta congelada hasta
  // su cancelacion automatica como mucho (4.13). Es publico: se ve en la obra.
  const { data: commerce } = await db.from('work_commerce').select('frozen_offer_id').eq('work_id', workId).maybeSingle()
  let frozenUntil: string | null = null
  if (commerce?.frozen_offer_id) {
    const { data: frozen } = await db.from('offers').select('auto_cancel_at').eq('id', commerce.frozen_offer_id).maybeSingle()
    frozenUntil = frozen?.auto_cancel_at ?? null
  }
  return { holderApproved: canSell(seller), holderCovered: covered, frozenUntil }
}

/**
 * La oferta vista por una de sus dos partes (4.12): los mensajes completos, el
 * papel de quien pregunta y lo que puede hacer. A nadie mas.
 */
export async function offerDetail(userId: string, offerId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('offers')
    .select(`${OFFER_COLUMNS}, accepted_at, auto_cancel_at, closed_at, close_reason`)
    .eq('id', offerId)
    .maybeSingle()
  const offer = data as (OfferRow & { accepted_at: string | null; auto_cancel_at: string | null; closed_at: string | null; close_reason: string | null }) | null
  if (!offer) return null
  const { data: work } = await db.from('works').select('id, title, tbt_id, current_owner_id').eq('id', offer.work_id).maybeSingle()
  if (!work) return null
  const role = work.current_owner_id === userId ? 'holder' : offer.from_user === userId ? 'offerer' : null
  if (!role) return null
  const [{ data: offerer }, { data: holder }, seller] = await Promise.all([
    db.from('profiles').select('display_name, public_alias').eq('id', offer.from_user).maybeSingle(),
    db.from('profiles').select('display_name, public_alias').eq('id', work.current_owner_id).maybeSingle(),
    sellerOf(db, work.current_owner_id),
  ])
  return {
    id: offer.id,
    role,
    work: { title: work.title ?? '', tbtId: work.tbt_id ?? '' },
    counterparty: role === 'holder'
      ? offerer?.public_alias || offerer?.display_name || null
      : holder?.public_alias || holder?.display_name || null,
    amount: Number(offer.amount),
    status: offer.status,
    suspended: offer.suspended,
    durationHours: offer.duration_hours,
    createdAt: offer.created_at,
    expiresAt: offer.expires_at,
    acceptedAt: offer.accepted_at,
    paymentDueAt: offer.payment_due_at,
    autoCancelAt: offer.auto_cancel_at,
    closedAt: offer.closed_at,
    closeReason: offer.close_reason,
    message: offer.message,
    responseMessage: offer.response_message,
    holderApproved: canSell(seller),
    // El pago de una oferta aceptada es del Stage 0; hasta entonces no se ofrece.
    payAvailable: false,
  }
}

// ── Hacer (4.2) ─────────────────────────────────────────────────────────────

export async function makeOffer(userId: string, workId: string, input: OfferInput) {
  const db = createAdminClient()
  const [work, rules, { data: commerce }] = await Promise.all([
    workOf(db, workId),
    getRules(),
    db.from('work_commerce').select('taking_offers, royalty_type, royalty_value, availability').eq('work_id', workId).maybeSingle(),
  ])
  if (!work || !commerce) return { error: 'not_found' as const }

  const plan = planOffer(input, { commerce: commerce as OfferCommerce, isHolder: work.current_owner_id === userId, rules })
  if (!plan.ok) return { error: plan.error, floor: plan.floor }

  const now = new Date()
  const { data: offer, error } = await db
    .from('offers')
    .insert({
      work_id: workId,
      from_user: userId,
      amount: plan.amount,
      currency: 'USD',
      solicited: commerce.availability === 'for_sale',
      duration_hours: plan.durationHours,
      expires_at: new Date(now.getTime() + plan.durationHours * 3_600_000).toISOString(),
      message: plan.message,
    })
    .select('id')
    .single()
  if (error || !offer) return { error: 'offer_failed' as const }

  await logEvent(db, offer.id, 'made', userId, { amount: plan.amount, duration_hours: plan.durationHours, with_message: !!plan.message })

  const holder = await sellerOf(db, work.current_owner_id)
  const unapproved = !canSell(holder)
  const variant = [unapproved ? 'unapproved' : '', plan.message ? 'message' : ''].filter(Boolean).join('_')
  await notify(db, {
    userId: work.current_owner_id,
    eventKey: 'offer_received',
    dedupeKey: `offer:${offer.id}:received`,
    data: { title: work.title ?? '', amount: money(plan.amount), offerId: offer.id, ...(variant ? { variant } : {}) },
    href: sheetOf(offer.id),
  })
  return { id: offer.id as string }
}

// ── Responder (4.3, 4.4, 4.6, 4.11) ─────────────────────────────────────────

export type OfferAction = 'accept' | 'decline' | 'withdraw' | 'cancel' | 'report'

export async function actOnOffer(userId: string, offerId: string, action: OfferAction, reply?: unknown, reportWhich?: 'message' | 'response') {
  const db = createAdminClient()
  const { data } = await db.from('offers').select(OFFER_COLUMNS).eq('id', offerId).maybeSingle()
  const offer = data as OfferRow | null
  if (!offer) return { error: 'not_found' }
  const work = await workOf(db, offer.work_id)
  if (!work) return { error: 'not_found' }
  const isHolder = work.current_owner_id === userId
  const isOfferer = offer.from_user === userId
  if (!isHolder && !isOfferer) return { error: 'not_party' }

  const rules = await getRules()
  const now = new Date()
  const title = work.title ?? ''
  const response = cleanMessage(reply)
  if (response && response.length > rules.offers.messageMax) return { error: 'message_too_long' }

  if (action === 'accept') {
    if (!isHolder) return { error: 'not_holder' }
    // S-3: sin estado de vendedor activo, Aceptar explica y lleva a Vender.
    if (!canSell(await sellerOf(db, userId))) return { error: 'need_approval' }
    const { data: commerce } = await db.from('work_commerce').select('frozen_offer_id').eq('work_id', offer.work_id).maybeSingle()
    if (commerce?.frozen_offer_id) return { error: 'frozen' }
    if (offer.status !== 'open' || offer.suspended || new Date(offer.expires_at) <= now) return { error: 'not_open' }

    const { error } = await db
      .from('offers')
      .update({
        status: 'accepted',
        accepted_at: now.toISOString(),
        responded_at: now.toISOString(),
        response_message: response,
        payment_due_at: new Date(now.getTime() + rules.offers.paymentWindowHours * 3_600_000).toISOString(),
        auto_cancel_at: new Date(now.getTime() + rules.offers.autoCancelDays * 86_400_000).toISOString(),
      })
      .eq('id', offer.id)
      .eq('status', 'open')
    if (error) return { error: 'offer_failed' }

    // La obra queda congelada para esta oferta; las demas abiertas quedan
    // suspendidas — ni rechazadas ni avisadas; sus vencimientos siguen.
    await db.from('work_commerce').update({ frozen_offer_id: offer.id }).eq('work_id', offer.work_id)
    await db.from('offers').update({ suspended: true }).eq('work_id', offer.work_id).eq('status', 'open').neq('id', offer.id)
    await logEvent(db, offer.id, 'accepted', userId, { with_reply: !!response })
    await notify(db, {
      userId: offer.from_user,
      eventKey: 'offer_accepted',
      dedupeKey: `offer:${offer.id}:accepted`,
      data: { title, hours: String(rules.offers.paymentWindowHours), offerId: offer.id },
      href: sheetOf(offer.id),
    })
    return { ok: true }
  }

  if (action === 'decline') {
    if (!isHolder) return { error: 'not_holder' }
    if (offer.status !== 'open') return { error: 'not_open' }
    await db
      .from('offers')
      .update({ status: 'declined', responded_at: now.toISOString(), response_message: response, closed_at: now.toISOString(), close_reason: 'declined' })
      .eq('id', offer.id)
      .eq('status', 'open')
    await logEvent(db, offer.id, 'declined', userId, { with_reply: !!response })
    await notify(db, { userId: offer.from_user, eventKey: 'offer_declined', dedupeKey: `offer:${offer.id}:declined`, data: { title, offerId: offer.id }, href: sheetOf(offer.id) })
    return { ok: true }
  }

  if (action === 'withdraw') {
    if (!isOfferer) return { error: 'not_offerer' }
    if (offer.status !== 'open') return { error: 'not_open' }
    await db
      .from('offers')
      .update({ status: 'withdrawn', closed_at: now.toISOString(), close_reason: 'withdrawn' })
      .eq('id', offer.id)
      .eq('status', 'open')
    await logEvent(db, offer.id, 'withdrawn', userId)
    // Solo al vendedor (4.4).
    await notify(db, { userId: work.current_owner_id, eventKey: 'offer_withdrawn', dedupeKey: `offer:${offer.id}:withdrawn`, data: { title, offerId: offer.id }, href: sheetOf(offer.id) })
    return { ok: true }
  }

  if (action === 'cancel') {
    if (!isHolder) return { error: 'not_holder' }
    // 4.6: el vendedor puede cancelar solo pasada la ventana de pago.
    if (offer.status !== 'accepted' || !offer.payment_due_at || new Date(offer.payment_due_at) > now) return { error: 'not_due' }
    await cancelUnpaid(db, offer, work, 'seller_cancel', userId)
    return { ok: true }
  }

  if (action === 'report') {
    const which = reportWhich === 'response' ? 'response' : 'message'
    const text = which === 'response' ? offer.response_message : offer.message
    if (!text) return { error: 'no_message' }
    // Un reporte por persona, oferta y mensaje.
    const { data: existing } = await db
      .from('tickets')
      .select('ref')
      .eq('subject_user', userId)
      .eq('category', 'report')
      .contains('context', { offer_id: offer.id, which })
      .maybeSingle()
    if (existing) return { ok: true, ref: existing.ref }
    const { data: ticket, error } = await db
      .from('tickets')
      .insert({
        origin: 'human',
        category: 'report',
        severity: 'secondary',
        subject: `Reported offer message — ${title}`.trim(),
        body: text,
        subject_user: userId,
        context: { kind: 'offer_report', offer_id: offer.id, work_id: offer.work_id, which },
      })
      .select('ref')
      .single()
    if (error || !ticket) return { error: 'report_failed' }
    await logEvent(db, offer.id, 'reported', userId, { which })
    return { ok: true, ref: ticket.ref }
  }

  return { error: 'unknown_action' }
}

// ── Falta de pago (4.6) ─────────────────────────────────────────────────────

/**
 * Cancela una oferta aceptada que no se pago: la limpia el vendedor pasada la
 * ventana, o el barrido en la cancelacion automatica. La congelacion se levanta,
 * las suspendidas que no vencieron vuelven a abrirse, y se avisa a los dos.
 */
export async function cancelUnpaid(
  db: SupabaseClient,
  offer: Pick<OfferRow, 'id' | 'work_id' | 'from_user'>,
  work: { current_owner_id: string; title: string | null },
  reason: 'seller_cancel' | 'auto_cancel',
  actorId: string | null
) {
  const now = new Date().toISOString()
  const { data: changed } = await db
    .from('offers')
    .update({ status: 'cancelled', closed_at: now, close_reason: reason })
    .eq('id', offer.id)
    .eq('status', 'accepted')
    .select('id')
  if (!changed?.length) return
  await db.from('work_commerce').update({ frozen_offer_id: null }).eq('work_id', offer.work_id).eq('frozen_offer_id', offer.id)
  await db.from('offers').update({ suspended: false }).eq('work_id', offer.work_id).eq('status', 'open').eq('suspended', true).gt('expires_at', now)
  await logEvent(db, offer.id, 'cancelled', actorId, { reason })
  const data = { title: work.title ?? '', offerId: offer.id }
  await notify(db, { userId: offer.from_user, eventKey: 'offer_cancelled', dedupeKey: `offer:${offer.id}:cancelled:buyer`, data, href: sheetOf(offer.id) })
  await notify(db, { userId: work.current_owner_id, eventKey: 'offer_cancelled', dedupeKey: `offer:${offer.id}:cancelled:seller`, data, href: sheetOf(offer.id) })
}

// ── Pagada (4.5) — la llama el Stage 0 al completar el cobro ─────────────────

export async function completeOffer(offerId: string) {
  const db = createAdminClient()
  const { data } = await db.from('offers').select(OFFER_COLUMNS).eq('id', offerId).maybeSingle()
  const offer = data as OfferRow | null
  if (!offer || offer.status !== 'accepted') return
  const work = await workOf(db, offer.work_id)
  const now = new Date().toISOString()
  await db.from('offers').update({ status: 'completed', closed_at: now, close_reason: 'paid' }).eq('id', offer.id).eq('status', 'accepted')
  await db.from('work_commerce').update({ frozen_offer_id: null }).eq('work_id', offer.work_id).eq('frozen_offer_id', offer.id)
  await logEvent(db, offer.id, 'completed', offer.from_user)

  // Las suspendidas se rechazan, con aviso (55).
  const { data: others } = await db.from('offers').select('id, from_user').eq('work_id', offer.work_id).eq('status', 'open').eq('suspended', true)
  for (const o of (others ?? []) as { id: string; from_user: string }[]) {
    await db.from('offers').update({ status: 'declined', closed_at: now, close_reason: 'sold', suspended: false }).eq('id', o.id).eq('status', 'open')
    await logEvent(db, o.id, 'declined', null, { reason: 'sold' })
    await notify(db, { userId: o.from_user, eventKey: 'offer_declined', dedupeKey: `offer:${o.id}:declined`, data: { title: work?.title ?? '', offerId: o.id }, href: sheetOf(o.id) })
  }
}

// ── El vendedor se pausa o lo suspenden (4.9) ───────────────────────────────

export async function lapseOffersOfHolder(holderId: string, reason: 'seller_paused' | 'seller_suspended') {
  const db = createAdminClient()
  const { data: works } = await db.from('works').select('id, title').eq('current_owner_id', holderId)
  const titleOf = new Map(((works ?? []) as { id: string; title: string | null }[]).map((w) => [w.id, w.title ?? '']))
  if (!titleOf.size) return
  const { data: live } = await db.from('offers').select('id, work_id, from_user').eq('status', 'open').in('work_id', Array.from(titleOf.keys()))
  const now = new Date().toISOString()
  for (const o of (live ?? []) as { id: string; work_id: string; from_user: string }[]) {
    const { data: changed } = await db
      .from('offers')
      // Stage 12: una pausa o suspension del vendedor CANCELA las vivas, con su motivo.
      .update({ status: 'cancelled', closed_at: now, close_reason: reason })
      .eq('id', o.id)
      .eq('status', 'open')
      .select('id')
    if (!changed?.length) continue
    await logEvent(db, o.id, 'cancelled', null, { reason })
    const data = { title: titleOf.get(o.work_id) ?? '', offerId: o.id }
    await notify(db, { userId: o.from_user, eventKey: 'offer_cancelled', dedupeKey: `offer:${o.id}:cancelled:buyer`, data, href: sheetOf(o.id) })
    await notify(db, { userId: holderId, eventKey: 'offer_cancelled', dedupeKey: `offer:${o.id}:cancelled:seller`, data, href: sheetOf(o.id) })
  }
}

// ── Aprobado: los compradores que esperaban (4.10) ──────────────────────────

export async function tellBuyersHolderReady(holderId: string) {
  const db = createAdminClient()
  const { data: works } = await db.from('works').select('id, title, tbt_id').eq('current_owner_id', holderId)
  const list = (works ?? []) as { id: string; title: string | null; tbt_id: string | null }[]
  const titleOf = new Map(list.map((w) => [w.id, w.title ?? '']))
  const tbtOf = new Map(list.map((w) => [w.id, w.tbt_id ?? '']))
  if (!titleOf.size) return
  const { data: lapsed } = await db
    .from('offers')
    .select('id, work_id, from_user')
    .eq('close_reason', 'expired_unapproved')
    .in('work_id', Array.from(titleOf.keys()))
  // Una vez por oferta: el dedupeKey es el de la oferta.
  for (const o of (lapsed ?? []) as { id: string; work_id: string; from_user: string }[]) {
    await notify(db, {
      userId: o.from_user,
      eventKey: 'offer_holder_ready',
      dedupeKey: `offer:${o.id}:holder_ready`,
      data: { title: titleOf.get(o.work_id) ?? '', offerId: o.id },
      href: `/work/${tbtOf.get(o.work_id) ?? ''}`,
    })
  }
}
