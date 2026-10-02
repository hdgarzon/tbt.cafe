import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase-admin'
import { getRules } from '@/lib/rules'
import { saleQuote, cents, type ChargePath, type RoyaltyType } from '@/lib/fees'
import { notify } from '@/lib/notify'
import { moveTokenForOwnership } from '@/lib/token-move'
import { issueTitle } from '@/lib/titles/issue'

/**
 * Completar una venta — Work Order 02, Stage 0.7.
 *
 * La unica funcion que completa una compra, y solo la llaman los webhooks
 * (0.7b): /purchase/success lee el estado y nunca completa nada. Idempotente
 * por la sesion: un evento repetido encuentra la venta hecha y no cambia nada.
 *
 * La mitad de base de datos va en una transaccion (complete_sale, 076): la
 * fila de dueno con la eleccion del titular, el bloqueo de la regalia, las
 * ganancias, los montos guardados (0.9c) y la oferta cerrada. Despues, fuera de
 * ella: el token (Chains 01 4.5), el registro de procedencia, el titulo y los
 * avisos — todo eso es reintentable y nada lo deshace.
 *
 * Los montos salen de saleQuote con el precio guardado en la transferencia y
 * los terminos de regalia de la obra. Si el cargo de Stripe no es lo que la
 * cotizacion dice, la venta se completa igual (el comprador pago) y se abre un
 * ticket: es una discrepancia que alguien tiene que mirar.
 */

export type SaleOutcome =
  | { status: 'completed'; historyId: string; transferId: string }
  | { status: 'already'; transferId: string }
  | { status: 'not_paid' | 'not_a_sale' | 'not_found' }

/** 0.6d: autenticado o intento reconocido. */
function threeDsSatisfied(charge: Stripe.Charge | null): boolean | null {
  const result = charge?.payment_method_details?.card?.three_d_secure?.result
  if (!result) return null
  return result === 'authenticated' || result === 'attempt_acknowledged'
}

export async function completeSale(sessionId: string, account: string | null = null): Promise<SaleOutcome> {
  const session = await stripe.checkout.sessions.retrieve(
    sessionId,
    { expand: ['payment_intent.latest_charge'] },
    account ? { stripeAccount: account } : undefined
  )
  const meta = session.metadata ?? {}
  if (meta.kind !== 'sale' || !meta.transfer_id) return { status: 'not_a_sale' }
  if (session.payment_status !== 'paid') return { status: 'not_paid' }

  const admin = createAdminClient()
  const { data: transfer } = await admin
    .from('transfers')
    .select('id, work_id, from_owner_id, to_owner_id, sale_price, payment_status, offer_id')
    .eq('id', meta.transfer_id)
    .maybeSingle()
  if (!transfer) return { status: 'not_found' }
  if (transfer.payment_status === 'completed') return { status: 'already', transferId: transfer.id }

  const { data: commerce } = await admin
    .from('work_commerce')
    .select('royalty_type, royalty_value')
    .eq('work_id', transfer.work_id)
    .maybeSingle()
  const path = (meta.path === 'direct' ? 'direct' : 'platform') as ChargePath
  const q = saleQuote(
    {
      price: Number(transfer.sale_price ?? 0),
      royalty: { type: (commerce?.royalty_type ?? 'none') as RoyaltyType, value: Number(commerce?.royalty_value ?? 0) },
      path,
    },
    await getRules()
  )

  const intent = session.payment_intent as Stripe.PaymentIntent | null
  const charge = (intent?.latest_charge ?? null) as Stripe.Charge | null

  const { data: result, error } = await admin.rpc('complete_sale', {
    p_transfer: transfer.id,
    p_amounts: {
      buyer_total: q.buyerTotal,
      processing: q.processing,
      application_fee: q.applicationFee,
      royalty_gross: q.royaltyGross,
      royalty_earning: q.royaltyEarning,
      platform_take: q.platformTake,
      seller_net: q.sellerNet,
      charge_path: path,
      provider: meta.provider ?? 'stripe',
      payment_intent: intent?.id ?? null,
    },
    p_three_ds: threeDsSatisfied(charge),
  })
  const done = result as { history_id: string | null; completed: boolean } | null
  if (error || !done?.history_id) throw new Error(`complete_sale failed for ${transfer.id}: ${error?.message ?? 'no history row'}`)
  // Dos entregas del mismo evento pueden pasar la lectura de arriba a la vez;
  // la que llego segunda espero el bloqueo y la encontro hecha. El token, el
  // ticket, el titulo y los avisos son de la que la completo.
  if (!done.completed) return { status: 'already', transferId: transfer.id }
  const historyId = done.history_id

  // Lo cobrado debe ser lo cotizado; si no, se completa y se mira.
  if (session.amount_total !== cents(q.buyerTotal)) {
    await admin.from('tickets').insert({
      origin: 'system',
      category: 'payments',
      severity: 'primary',
      subject: `Sale charged ${session.amount_total} cents, quoted ${cents(q.buyerTotal)}`,
      body: `Transfer ${transfer.id} completed; the Stripe charge differs from saleQuote.`,
      subject_user: transfer.to_owner_id,
      context: { kind: 'sale_amount_mismatch', transfer_id: transfer.id, charged: session.amount_total, quoted: cents(q.buyerTotal) },
    })
  }

  // ── Despues de la transaccion ──────────────────────────────────────────────
  const { data: work } = await admin.from('works').select('tbt_id, title').eq('id', transfer.work_id).single()
  const { data: row } = await admin.from('ownership_history').select('sequence_number').eq('id', historyId).single()
  const title = work?.title ?? ''

  // Las demas ofertas abiertas eran para el dueno anterior.
  const { closeOffersOnSale } = await import('@/lib/offers-server')
  await closeOffersOnSale(transfer.work_id)

  if (work?.tbt_id && row) {
    const signature = await moveTokenForOwnership(admin, {
      workId: transfer.work_id,
      tbtId: work.tbt_id,
      fromSequence: row.sequence_number - 1,
      toSequence: row.sequence_number,
      historyId,
    })
    if (signature) {
      try {
        const { publishProvenance } = await import('@/lib/chain/provenance-publish')
        await publishProvenance(admin, historyId)
      } catch (chainError) {
        console.error('[sale] no se pudo publicar la procedencia:', chainError)
      }
    }
  }

  await issueTitle(admin, {
    workId: transfer.work_id,
    holderId: transfer.to_owner_id,
    event: 'PURCHASED',
    eventDate: new Date(),
    sourceKey: `transfer:${transfer.id}`,
  }).catch((e) => console.error('[sale] title:', e))

  const href = work?.tbt_id ? `/work/${work.tbt_id}` : undefined
  // 0.9a: la confirmacion, con su «Entendido».
  await notify(admin, {
    userId: transfer.to_owner_id,
    eventKey: 'purchases',
    dedupeKey: `${transfer.id}:bought`,
    data: { variant: 'bought', title, transferId: transfer.id },
    href: `/purchase/confirmed?transferId=${transfer.id}`,
  })
  await notify(admin, {
    userId: transfer.from_owner_id,
    eventKey: 'purchases',
    dedupeKey: `${transfer.id}:sold`,
    data: { variant: 'sold', title },
    href,
  })

  return { status: 'completed', historyId, transferId: transfer.id }
}
