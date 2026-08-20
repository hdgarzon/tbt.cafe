import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import { authenticate } from '@/lib/route-auth'

/**
 * El emisor cancela una transferencia de dos fases que sigue pendiente
 * (Transfer Companion, "Pending" → "Cancelled by sender"). Libera el hold de
 * Stripe — nunca se cobra nada. Idempotente: cancelar una PaymentIntent ya
 * cancelada no es un error.
 */

export async function POST(request: NextRequest) {

  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { user } = auth

    const { transferId } = await request.json()
    if (!transferId) return NextResponse.json({ error: 'missingTransferId' }, { status: 400 })

    const service = createAdminClient()
    const { data: transfer, error } = await service
      .from('transfers')
      .select('id, from_owner_id, is_two_phase, payment_status, outcome, stripe_payment_intent_id')
      .eq('id', transferId)
      .single()
    if (error || !transfer) return NextResponse.json({ error: 'transferNotFound' }, { status: 404 })
    if (transfer.from_owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!transfer.is_two_phase) return NextResponse.json({ error: 'notTwoPhase' }, { status: 400 })
    if (transfer.outcome !== null || transfer.payment_status !== 'pending') {
      return NextResponse.json({ error: 'alreadyResolved' }, { status: 409 })
    }

    if (transfer.stripe_payment_intent_id) {
      try {
        await stripe.paymentIntents.cancel(transfer.stripe_payment_intent_id)
      } catch (stripeError: any) {
        // Already canceled/captured on Stripe's side is not a client error —
        // surface anything else, but let an already-canceled hold pass through.
        if (stripeError?.code !== 'payment_intent_unexpected_state') {
          console.error('Error canceling PaymentIntent:', stripeError)
          return NextResponse.json({ error: 'cancelFailed' }, { status: 500 })
        }
      }
    }

    await service
      .from('transfers')
      .update({ payment_status: 'expired', outcome: 'cancelled' })
      .eq('id', transferId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in /api/transfer/cancel:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
