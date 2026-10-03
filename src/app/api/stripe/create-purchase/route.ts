import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { enforceLadder } from '@/lib/auth-ladder-server'
import { getRules, assertNotPaused } from '@/lib/rules'
import { saleQuote, cents, type ChargePath } from '@/lib/fees'
import { royaltyOf, type WorkCommerce } from '@/lib/work-data'
import { canSell } from '@/lib/seller'
import { appOrigin } from '@/lib/app-origin'
import { planPurchase, termsVersion } from '@/lib/purchase'

/**
 * POST /api/stripe/create-purchase — la compra iniciada por el comprador.
 * Work Order 02, Stage 0.3b, 0.4a, 0.5 y 0.6a.
 *
 * El cargo es el precio de la obra mas la tarifa de servicio del comprador, y
 * lo que se cobra es exactamente lo que cotiza saleQuote. Dos vias, segun el
 * pais de quien vende (charge_path, 059):
 *  - directa: la sesion se crea en la cuenta conectada del vendedor y la
 *    plataforma cobra su application fee (0.1b); el estado de cuenta muestra
 *    al vendedor.
 *  - plataforma: la sesion se crea en tbt.cafe, con transfer_group; el estado
 *    de cuenta muestra tbt.cafe y el neto del vendedor se vuelve una ganancia
 *    de venta al completarse (0.4b).
 *
 * Esta ruta no completa nada: la venta la completa el webhook (0.7b).
 */
export async function POST(request: NextRequest) {
  const origin = appOrigin()
  if (!origin) return NextResponse.json({ error: 'origin_unavailable' }, { status: 500 })

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { user } = auth

  const body = (await request.json().catch(() => ({}))) as {
    workId?: string
    biometricProof?: string
    embedded?: boolean
    holderNamed?: boolean
  }
  if (!body.workId) return NextResponse.json({ error: 'workId_required' }, { status: 400 })

  // Stage 11: con las ventas en pausa no se abre ningun cobro nuevo.
  const paused = await assertNotPaused('selling')
  if (paused) return NextResponse.json(paused, { status: 423 })

  const admin = createAdminClient()
  const rules = await getRules()
  const { data: work } = await admin.from('works').select('id, title, status, current_owner_id').eq('id', body.workId).maybeSingle()
  if (!work || work.status !== 'certified') return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [{ data: commerce }, { data: seller }] = await Promise.all([
    admin
      .from('work_commerce')
      .select('initial_price, currency, availability, taking_offers, royalty_type, royalty_value, royalty_locked, frozen_offer_id')
      .eq('work_id', work.id)
      .maybeSingle(),
    admin.from('seller_accounts').select('status, suspended_at, charge_path').eq('user_id', work.current_owner_id).maybeSingle(),
  ])
  const { data: offer } = commerce?.frozen_offer_id
    ? await admin.from('offers').select('id, from_user, status, amount, payment_due_at').eq('id', commerce.frozen_offer_id).maybeSingle()
    : { data: null }

  // 0.5c, en su orden.
  const plan = planPurchase({
    callerId: user.id,
    holderId: work.current_owner_id,
    sellingPaused: rules.pauses.selling.on,
    sellerActive: canSell(seller),
    availability: commerce?.availability ?? 'not_for_sale',
    listedPrice: commerce?.initial_price != null ? Number(commerce.initial_price) : null,
    frozenOfferId: commerce?.frozen_offer_id ?? null,
    offer: offer ? { id: offer.id, fromUser: offer.from_user, status: offer.status, amount: Number(offer.amount), paymentDueAt: offer.payment_due_at } : null,
    now: Date.now(),
  })
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.error === 'selling_paused' ? 423 : 409 })

  const ladder = await enforceLadder({
    admin,
    userId: user.id,
    action: 'purchase',
    amount: plan.amount,
    workId: work.id,
    biometricProof: body.biometricProof,
    counterpartyId: work.current_owner_id,
  })
  if (!ladder.ok) return NextResponse.json({ error: ladder.error }, { status: ladder.status })

  // La via de cobro, y en la directa la cuenta conectada que toma el cargo.
  const path: ChargePath = seller?.charge_path === 'direct' ? 'direct' : 'platform'
  let account: string | null = null
  if (path === 'direct') {
    const { data: connect } = await admin
      .from('payout_connect_accounts')
      .select('account_id, card_payments_enabled')
      .eq('user_id', work.current_owner_id)
      .maybeSingle()
    /*
     * 0.3a: la cuenta tiene que poder tomar el cargo. Sin `card_payments`
     * activa, Stripe lo rechazaria despues de que el comprador pulso Pagar; se
     * rechaza aqui, antes de crear la transferencia y la sesion.
     */
    if (!connect?.account_id || !connect?.card_payments_enabled) return NextResponse.json({ error: 'seller_not_ready' }, { status: 409 })
    account = connect.account_id
  }

  // 0.5b: la regalia por el unico resolvedor; 0.1: el desglose por la unica aritmetica.
  const q = saleQuote({ price: plan.amount, royalty: royaltyOf(commerce as WorkCommerce), path }, rules)

  const { data: transfer, error: transferError } = await admin
    .from('transfers')
    .insert({
      work_id: work.id,
      from_owner_id: work.current_owner_id,
      to_owner_id: user.id,
      transfer_type: 'automatic',
      value_kind: 'sale',
      sale_price: q.price,
      royalty_amount: q.royaltyGross,
      status: 'payment_pending',
      payment_status: 'pending',
      charge_path: path,
      provider: 'stripe',
      offer_id: plan.offerId,
      // 0.8a: la eleccion del comprador; sin eleccion, nadie se nombra.
      holder_named: body.holderNamed === true,
    })
    .select('id')
    .single()
  if (transferError || !transfer) return NextResponse.json({ error: 'purchase_failed' }, { status: 500 })

  // 0.8b: la primera compra acepta los Terms al tocar Pagar.
  const { count: accepted } = await admin.from('terms_acceptances').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  if (!accepted) await admin.from('terms_acceptances').insert({ user_id: user.id, transfer_id: transfer.id, terms_version: termsVersion() })

  const metadata = {
    kind: 'sale',
    work_id: work.id,
    transfer_id: transfer.id,
    ...(plan.offerId ? { offer_id: plan.offerId } : {}),
    path,
    provider: 'stripe',
  }
  const returnUrl = `${origin}/purchase/success?session_id={CHECKOUT_SESSION_ID}&transferId=${transfer.id}`
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: [
      { quantity: 1, price_data: { currency: 'usd', unit_amount: cents(q.price), product_data: { name: work.title ?? 'Work' } } },
      { quantity: 1, price_data: { currency: 'usd', unit_amount: cents(q.serviceBuyer), product_data: { name: 'tbt.cafe service fee' } } },
    ],
    // 0.6a: 3-D Secure en las dos vias.
    payment_method_options: { card: { request_three_d_secure: 'any' } },
    metadata,
    payment_intent_data:
      path === 'direct'
        ? { application_fee_amount: cents(q.applicationFee ?? 0), metadata }
        : { transfer_group: transfer.id, metadata },
    ...(body.embedded
      ? { ui_mode: 'embedded_page' as Stripe.Checkout.SessionCreateParams.UiMode, return_url: returnUrl }
      : { success_url: returnUrl, cancel_url: `${origin}/purchase/cancel?workId=${work.id}` }),
  }

  const session = await stripe.checkout.sessions.create(params, {
    idempotencyKey: `sale:${transfer.id}`,
    ...(account ? { stripeAccount: account } : {}),
  })
  await admin.from('transfers').update({ stripe_checkout_session_id: session.id, payment_link: session.url }).eq('id', transfer.id)

  return NextResponse.json({
    clientSecret: session.client_secret,
    checkoutUrl: session.url,
    sessionId: session.id,
    transferId: transfer.id,
    // 0.8c: lo que dira el estado de cuenta.
    statement: path,
    // En la via directa el checkout embebido se monta sobre la cuenta conectada.
    stripeAccount: account,
  })
}
