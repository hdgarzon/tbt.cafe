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
      .select('id, from_owner_id, is_two_phase, payment_status, outcome, authorized_at, stripe_payment_intent_id, stripe_checkout_session_id')
      .eq('id', transferId)
      .single()
    if (error || !transfer) return NextResponse.json({ error: 'transferNotFound' }, { status: 404 })
    if (transfer.from_owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!transfer.is_two_phase) return NextResponse.json({ error: 'notTwoPhase' }, { status: 400 })
    if (transfer.outcome !== null || transfer.payment_status !== 'pending') {
      return NextResponse.json({ error: 'alreadyResolved' }, { status: 409 })
    }

    /*
     * La retencion se suelta ANTES de dar la fila por cancelada.
     *
     * Aqui habia un `if (stripe_payment_intent_id)` a secas: cuando era nulo se
     * saltaba el cancel de Stripe, se marcaba la fila cancelada y se devolvia
     * `success: true` con el dinero del cliente todavia retenido hasta que la
     * autorizacion caducara sola. Decir que se cancelo sin soltar el dinero es
     * la peor version de este error, porque nadie va a mirar.
     *
     * El id lo escribe el webhook, asi que puede faltar si este llega tarde o
     * falla. En ese caso se saca de la sesion de checkout, que si tenemos desde
     * que se creo.
     */
    let intentId: string | null = transfer.stripe_payment_intent_id ?? null

    if (!intentId && transfer.stripe_checkout_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(transfer.stripe_checkout_session_id)
        intentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null)
      } catch (lookupError) {
        console.error('[transfer/cancel] no se pudo leer la sesion:', lookupError)
        // Se sigue: si de verdad no habia pago, mas abajo no hay nada que soltar.
      }
    }

    if (intentId) {
      try {
        await stripe.paymentIntents.cancel(intentId)
      } catch (stripeError: any) {
        // Already canceled/captured on Stripe's side is not a client error —
        // surface anything else, but let an already-canceled hold pass through.
        if (stripeError?.code !== 'payment_intent_unexpected_state') {
          console.error('Error canceling PaymentIntent:', stripeError)
          return NextResponse.json({ error: 'cancelFailed' }, { status: 500 })
        }
      }
    } else if (transfer.authorized_at) {
      /*
       * Consta que se autorizo y no se encontro que soltar. NO se marca como
       * cancelada: dejarla `pending` es molesto y visible; decir que se cancelo
       * deja una retencion huerfana que nadie va a buscar.
       */
      console.error(
        `[transfer/cancel] ${transferId} tiene authorized_at pero ningun PaymentIntent que cancelar`
      )
      return NextResponse.json({ error: 'cancelFailed' }, { status: 500 })
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
