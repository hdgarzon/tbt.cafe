import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import { authenticate } from '@/lib/route-auth'

const HOLD_WINDOW_MS = 24 * 3600 * 1000

/**
 * Fase 2 del transfer de dos fases — el RECIPIENTE responde (Transfer
 * Companion). 'accept': captura el pago recién ahora, luego reutiliza
 * /api/complete-transfer (la misma ruta probada que ya escribe la cadena,
 * el certificado y el ownership_history para el flujo legacy) para mover la
 * propiedad — evita duplicar esa lógica. 'reject': libera el hold, nada se
 * cobra. Ambas ramas requieren sesión — la vista de aceptar en tbt-cafe crea
 * autenticación inline si el recipiente no tiene cuenta todavía.
 */

export async function POST(request: NextRequest) {

  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { user } = auth

    const { transferId, action } = await request.json()
    if (!transferId || (action !== 'accept' && action !== 'reject')) {
      return NextResponse.json({ error: 'invalidRequest' }, { status: 400 })
    }

    const service = createAdminClient()
    const { data: transfer, error } = await service
      .from('transfers')
      .select('id, work_id, from_owner_id, is_two_phase, payment_status, outcome, stripe_payment_intent_id, authorized_at, work:works(current_owner_id)')
      .eq('id', transferId)
      .single()
    if (error || !transfer) return NextResponse.json({ error: 'transferNotFound' }, { status: 404 })
    if (!transfer.is_two_phase) return NextResponse.json({ error: 'notTwoPhase' }, { status: 400 })
    if (transfer.outcome !== null || transfer.payment_status !== 'pending') {
      return NextResponse.json({ error: 'alreadyResolved' }, { status: 409 })
    }
    if (!transfer.stripe_payment_intent_id || !transfer.authorized_at) {
      return NextResponse.json({ error: 'notYetAuthorized' }, { status: 409 })
    }

    // Ownership-drift guard, same spirit as /api/complete-transfer: the
    // sender named on this transfer must still own the work.
    const work = Array.isArray(transfer.work) ? transfer.work[0] : transfer.work
    if (work?.current_owner_id !== transfer.from_owner_id) {
      return NextResponse.json({ error: 'ownershipChanged' }, { status: 409 })
    }

    const elapsed = Date.now() - new Date(transfer.authorized_at).getTime()
    if (elapsed > HOLD_WINDOW_MS) {
      // Card holds do not reliably survive past 24h — release cleanly rather
      // than risk a capture failure the sender wasn't told about. Ask them
      // to resend (Transfer Companion, "24 HOURS IS NOT ARBITRARY").
      try {
        await stripe.paymentIntents.cancel(transfer.stripe_payment_intent_id)
      } catch (e) {
        console.error('Error releasing lapsed hold:', e)
      }
      await service.from('transfers').update({ payment_status: 'expired', outcome: 'lapsed' }).eq('id', transferId)
      return NextResponse.json({ error: 'lapsed' }, { status: 410 })
    }

    if (action === 'reject') {
      try {
        await stripe.paymentIntents.cancel(transfer.stripe_payment_intent_id)
      } catch (stripeError: any) {
        if (stripeError?.code !== 'payment_intent_unexpected_state') {
          console.error('Error canceling PaymentIntent on reject:', stripeError)
          return NextResponse.json({ error: 'rejectFailed' }, { status: 500 })
        }
      }
      await service.from('transfers').update({ payment_status: 'expired', outcome: 'rejected' }).eq('id', transferId)
      return NextResponse.json({ success: true, outcome: 'rejected' })
    }

    // action === 'accept'
    try {
      await stripe.paymentIntents.capture(transfer.stripe_payment_intent_id)
    } catch (stripeError) {
      console.error('Error capturing PaymentIntent on accept:', stripeError)
      return NextResponse.json({ error: 'captureFailed' }, { status: 500 })
    }

    // Attach the accepting user as the recipient and mark payment completed
    // BEFORE calling complete-transfer — that route reads to_owner_id and
    // gates its ownership-transfer logic on payment_status === 'completed'.
    const { error: updateError } = await service
      .from('transfers')
      .update({
        to_owner_id: user.id,
        payment_status: 'completed',
        payment_reference: transfer.stripe_payment_intent_id,
        outcome: 'accepted',
      })
      .eq('id', transferId)
    if (updateError) {
      console.error('Error attaching recipient after capture:', updateError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization')
    const completeRes = await fetch(new URL('/api/complete-transfer', request.nextUrl.origin), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ transferId }),
    })
    const completeBody = await completeRes.json()
    if (!completeRes.ok) {
      // Payment is captured and CANNOT be silently un-captured here — the
      // funds are real. Surface this loudly for manual follow-up rather than
      // telling the recipient the transfer failed while their card was charged.
      console.error('CRITICAL: capture succeeded but complete-transfer failed', {
        transferId,
        completeBody,
      })
      return NextResponse.json({ error: 'ownershipTransferFailed', capturedButNotFinalized: true }, { status: 500 })
    }

    return NextResponse.json({ success: true, outcome: 'accepted', ...completeBody })
  } catch (error) {
    console.error('Error in /api/transfer/respond:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
