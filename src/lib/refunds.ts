import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { cents } from '@/lib/fees'
import { notify } from '@/lib/notify'
import { restoreToSeller } from '@/lib/restoring'

/**
 * El reembolso de una venta — Work Order 02, 8.2 y 8.5.
 *
 * Nunca automatico: lo llama solo api/admin/refunds, despues de la regla de dos
 * personas bajo `transactions.refund`. Ningun webhook lo invoca.
 *
 * EL ORDEN
 *
 *   1. El libro (refund_sale_ledger, 078): en una transaccion se anulan las
 *      ganancias que la venta creo y que nadie cobro. Si en la via de
 *      plataforma ya se cobraron, se rechaza aqui sin tocar nada: eso es un
 *      saldo negativo (8.3), y esa tabla espera la respuesta de Federico.
 *   2. El dinero. Se devuelve el precio, no las dos tarifas de $8 (8.2).
 *        directa     en la cuenta conectada, sin devolver la application fee;
 *                    y si la regalia se anulo, exactamente royalty_gross de
 *                    esa fee vuelve al vendedor.
 *        plataforma  desde el saldo de la plataforma.
 *   3. La obra vuelve al vendedor (8.4) y el comprador sabe cuanto se le
 *      devolvio (8.5).
 *
 * Al reves —Stripe primero— un fallo de la base dejaria una venta reembolsada
 * con sus ganancias todavia cobrables.
 *
 * REINTENTOS
 *
 * Cada llamada a Stripe lleva su clave de idempotencia, pero Stripe las olvida a
 * las 24 horas. Por eso lo que ya se hizo se lee de la transferencia y no se
 * repite: `refund_state === 'refunded'` no vuelve a reembolsar, y un
 * `refund_fee_reversal_id` guardado no vuelve a devolver la fee.
 */

export type RefundOutcome =
  | { status: 'refunded'; amount: number; royaltyReturned: boolean; restored: boolean }
  | { status: 'refused'; reason: string }
  | { status: 'failed'; reason: string }

type Ledger = {
  refund_state: 'ledger' | 'refunded' | 'failed'
  path: 'direct' | 'platform'
  amount: number
  royalty_cancelled: boolean
  royalty_gross: number | null
  payment_intent: string
}

/** Los rechazos del libro que son una respuesta, no un fallo. */
const REFUSALS = ['transfer_not_found', 'not_a_completed_sale', 'refund_disputed', 'refund_needs_negative_balance']

export async function refundSale(
  admin: SupabaseClient,
  p: { transferId: string; reason: string }
): Promise<RefundOutcome> {
  const { data, error } = await admin.rpc('refund_sale_ledger', { p_transfer_id: p.transferId, p_reason: p.reason })
  if (error) {
    const refusal = REFUSALS.find((r) => error.message.includes(r))
    return refusal ? { status: 'refused', reason: refusal } : { status: 'failed', reason: 'ledger_failed' }
  }
  const ledger = data as Ledger

  const { data: transfer } = await admin
    .from('transfers')
    .select('id, work_id, from_owner_id, to_owner_id, refund_id, refund_fee_reversal_id')
    .eq('id', p.transferId)
    .single()
  if (!transfer) return { status: 'failed', reason: 'transfer_not_found' }

  let account: string | null = null
  if (ledger.path === 'direct') {
    const { data: connect } = await admin.from('payout_connect_accounts').select('account_id').eq('user_id', transfer.from_owner_id).maybeSingle()
    if (!connect?.account_id) return failed(admin, p.transferId, 'seller_account_missing')
    account = connect.account_id
  }

  let royaltyReturned = !!transfer.refund_fee_reversal_id

  if (ledger.refund_state !== 'refunded') {
    try {
      const metadata = { transfer_id: p.transferId, kind: 'sale_refund' }
      const refund = await stripe.refunds.create(
        ledger.path === 'direct'
          ? { payment_intent: ledger.payment_intent, amount: cents(ledger.amount), refund_application_fee: false, metadata }
          : { payment_intent: ledger.payment_intent, amount: cents(ledger.amount), metadata },
        { idempotencyKey: `refund:${p.transferId}`, ...(account ? { stripeAccount: account } : {}) }
      )

      let reversal: string | null = transfer.refund_fee_reversal_id
      if (ledger.royalty_cancelled) {
        if (!reversal && account && Number(ledger.royalty_gross) > 0) {
          const intent = await stripe.paymentIntents.retrieve(
            ledger.payment_intent,
            { expand: ['latest_charge'] },
            { stripeAccount: account }
          )
          const fee = (intent.latest_charge as Stripe.Charge | null)?.application_fee
          const feeId = typeof fee === 'string' ? fee : fee?.id
          if (!feeId) throw new Error('application_fee_not_found')
          const feeRefund = await stripe.applicationFees.createRefund(
            feeId,
            { amount: cents(Number(ledger.royalty_gross)), metadata },
            { idempotencyKey: `refund-royalty:${p.transferId}` }
          )
          reversal = feeRefund.id
        }
        royaltyReturned = !!reversal
      }

      await admin
        .from('transfers')
        .update({ refund_state: 'refunded', refund_id: refund.id, refund_fee_reversal_id: reversal, refunded_at: new Date().toISOString() })
        .eq('id', p.transferId)
    } catch (stripeError) {
      return failed(admin, p.transferId, stripeError instanceof Error ? stripeError.message : 'stripe_refund_failed')
    }
  }

  // 8.4: la obra vuelve al vendedor con una fila nueva; idempotente.
  const restoring = await restoreToSeller(admin, { transferId: p.transferId, reason: 'refund' })

  // 8.5: el comprador, con la cifra. El vendedor recibe el titulo de
  // restitucion por la entrega de titulos cuando su etiqueta exista.
  const { data: work } = await admin.from('works').select('tbt_id, title').eq('id', transfer.work_id).maybeSingle()
  await notify(admin, {
    userId: transfer.to_owner_id,
    eventKey: 'purchases',
    dedupeKey: `${p.transferId}:refunded`,
    data: { variant: 'refunded', title: work?.title ?? '', amount: formatUsd(ledger.amount) },
    href: work?.tbt_id ? `/work/${work.tbt_id}` : undefined,
  })

  return { status: 'refunded', amount: Number(ledger.amount), royaltyReturned, restored: restoring.restored || !!restoring.historyId }
}

/**
 * La tarifa de servicio del comprador, aparte (8.2): nunca va con el reembolso
 * de la venta, y solo se devuelve cuando un ticket lo decide. Las mismas dos
 * personas, y la referencia del ticket queda en el metadata del reembolso.
 *
 * En la via directa los $8 se cobraron en la cuenta conectada y la plataforma
 * se los quedo en la application fee: se devuelven al comprador desde esa
 * cuenta y se le reponen al vendedor desde la fee, para que no los pague el.
 */
export async function refundServiceFee(
  admin: SupabaseClient,
  p: { transferId: string; ticketRef: string }
): Promise<RefundOutcome> {
  const { data: ticket } = await admin.from('tickets').select('ref').eq('ref', p.ticketRef).maybeSingle()
  if (!ticket) return { status: 'refused', reason: 'ticket_not_found' }

  const { data: transfer } = await admin
    .from('transfers')
    .select('id, from_owner_id, charge_path, value_kind, payment_status, buyer_total, sale_price, stripe_payment_intent_id, service_fee_refund_id')
    .eq('id', p.transferId)
    .maybeSingle()
  if (!transfer || transfer.value_kind !== 'sale' || transfer.payment_status !== 'completed' || !transfer.stripe_payment_intent_id) {
    return { status: 'refused', reason: 'not_a_completed_sale' }
  }
  const fee = Math.round((Number(transfer.buyer_total) - Number(transfer.sale_price)) * 100) / 100
  if (transfer.service_fee_refund_id) return { status: 'refunded', amount: fee, royaltyReturned: false, restored: false }
  if (!(fee > 0)) return { status: 'refused', reason: 'no_service_fee' }

  let account: string | null = null
  if (transfer.charge_path === 'direct') {
    const { data: connect } = await admin.from('payout_connect_accounts').select('account_id').eq('user_id', transfer.from_owner_id).maybeSingle()
    if (!connect?.account_id) return { status: 'failed', reason: 'seller_account_missing' }
    account = connect.account_id
  }

  try {
    const metadata = { transfer_id: p.transferId, kind: 'service_fee_refund', ticket: p.ticketRef }
    const refund = await stripe.refunds.create(
      { payment_intent: transfer.stripe_payment_intent_id, amount: cents(fee), metadata },
      { idempotencyKey: `refund-fee:${p.transferId}`, ...(account ? { stripeAccount: account } : {}) }
    )
    if (account) {
      const intent = await stripe.paymentIntents.retrieve(transfer.stripe_payment_intent_id, { expand: ['latest_charge'] }, { stripeAccount: account })
      const appFee = (intent.latest_charge as Stripe.Charge | null)?.application_fee
      const feeId = typeof appFee === 'string' ? appFee : appFee?.id
      if (!feeId) throw new Error('application_fee_not_found')
      await stripe.applicationFees.createRefund(feeId, { amount: cents(fee), metadata }, { idempotencyKey: `refund-fee-reversal:${p.transferId}` })
    }
    await admin
      .from('transfers')
      .update({ service_fee_refund_id: refund.id, service_fee_refunded_at: new Date().toISOString() })
      .eq('id', p.transferId)
    return { status: 'refunded', amount: fee, royaltyReturned: false, restored: false }
  } catch (error) {
    console.error('[refunds] la tarifa de servicio no se pudo devolver', p.transferId, error)
    return { status: 'failed', reason: error instanceof Error ? error.message : 'stripe_refund_failed' }
  }
}

/**
 * El libro ya anulo las ganancias y Stripe no devolvio el dinero. Queda
 * `failed` y un ticket para operaciones. La aprobacion ya se uso (se sella al
 * aplicarla); una nueva retoma desde aqui, porque el libro devuelve lo que ya
 * guardo y no vuelve a anular nada.
 */
async function failed(admin: SupabaseClient, transferId: string, reason: string): Promise<RefundOutcome> {
  await admin.from('transfers').update({ refund_state: 'failed' }).eq('id', transferId).neq('refund_state', 'refunded')
  await admin.from('tickets').insert({
    origin: 'system',
    category: 'payments',
    severity: 'primary',
    subject: `Refund of transfer ${transferId} did not complete`,
    body: `The earnings are cancelled; the Stripe refund failed: ${reason}. A new approved refund for this transfer resumes it.`,
    subject_user: null,
    context: { kind: 'refund_failed', transfer_id: transferId, reason },
  })
  console.error('[refunds] reembolso incompleto', transferId, reason)
  return { status: 'failed', reason }
}

const formatUsd = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
