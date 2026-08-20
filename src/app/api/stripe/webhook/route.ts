import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for the Stripe webhook')
}

// Use service role client for webhook (no user auth context)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    )
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutComplete(session)
      break
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutExpired(session)
      break
    }
    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const { type, workId, userId, transferId, flow } = session.metadata || {}

  console.log('Payment completed:', { type, workId, userId, transferId, flow })

  if (type === 'tbt_creation' && workId) {
    // Update tbt_payments
    const { error: paymentError } = await supabase
      .from('tbt_payments')
      .update({
        status: 'completed',
        stripe_payment_intent_id: session.payment_intent as string,
        completed_at: new Date().toISOString(),
      })
      .eq('stripe_checkout_session_id', session.id)

    if (paymentError) {
      console.error('Error updating tbt_payments:', paymentError)
    }

    // Update work payment status
    const { error: workError } = await supabase
      .from('works')
      .update({
        payment_status: 'completed',
        payment_intent_id: session.payment_intent as string,
        payment_completed_at: new Date().toISOString(),
      })
      .eq('id', workId)

    if (workError) {
      console.error('Error updating work payment_status:', workError)
    } else {
      console.log(`Work payment_status updated to completed for: ${workId}`)
    }

    console.log(`TBT creation payment completed for work: ${workId}`)
  } else if (type === 'transfer' && transferId && flow === 'two_phase') {
    // Two-phase (tbt.cafe Build Spec 02): the card is AUTHORISED only — do
    // NOT mark payment_status completed here, that would let the sender be
    // charged before the recipient ever agrees. payment_status stays
    // 'pending' (meaning "held, not captured") until /api/transfer/respond
    // captures it on accept. Record the hold and notify the recipient.
    const { error: transferError } = await supabase
      .from('transfers')
      .update({
        stripe_payment_intent_id: session.payment_intent as string,
        authorized_at: new Date().toISOString(),
      })
      .eq('id', transferId)

    if (transferError) {
      console.error('Error recording two-phase transfer authorization:', transferError)
    } else {
      console.log(`Two-phase transfer authorized (not captured): ${transferId}`)
    }

    await notifyRecipientOfPendingTransfer(transferId)
  } else if (type === 'transfer' && transferId) {
    // Legacy single-phase transfer (/transferir): payment IS the completion.
    const { error: transferError } = await supabase
      .from('transfers')
      .update({
        payment_status: 'completed',
        payment_reference: session.payment_intent as string,
      })
      .eq('id', transferId)

    if (transferError) {
      console.error('Error updating transfer:', transferError)
    }

    console.log(`Transfer payment completed for transfer: ${transferId}`)
  }
}

/**
 * SMS al recipiente con el link para aceptar/rechazar — no tiene cuenta
 * necesariamente, así que este es su único punto de entrada al flujo
 * (Transfer Companion: "Reached by SMS link"). Best-effort: un fallo en el
 * envío no debe tumbar el webhook ni la autorización ya confirmada — el
 * remitente puede ver el estado "pending" y reenviar desde el Action tab.
 */
async function notifyRecipientOfPendingTransfer(transferId: string) {
  try {
    const { data: transfer } = await supabase
      .from('transfers')
      .select('new_owner_phone, new_owner_name, from_owner_name, work:works(title)')
      .eq('id', transferId)
      .single()
    if (!transfer?.new_owner_phone) return

    const work = Array.isArray(transfer.work) ? transfer.work[0] : transfer.work
    const acceptUrl = `${process.env.NEXT_PUBLIC_TBT_CAFE_URL || 'https://tbt.cafe'}/transfer/accept/${transferId}`
    const message =
      `${transfer.from_owner_name || 'Someone'} is transferring "${work?.title || 'a work'}" to you on tbt.cafe.\n\n` +
      `Accept or decline: ${acceptUrl}\n\nExpires in 24 hours. Nothing is charged unless you accept.`

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
      const twilio = (await import('twilio')).default
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: transfer.new_owner_phone,
      })
    } else {
      console.log('⚠️ Twilio not configured — would SMS:', transfer.new_owner_phone, message)
    }
  } catch (err) {
    console.error('Error notifying transfer recipient:', err)
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const { type, workId, transferId, flow } = session.metadata || {}

  if (type === 'tbt_creation' && workId) {
    await supabase
      .from('tbt_payments')
      .update({ status: 'expired' })
      .eq('stripe_checkout_session_id', session.id)

    await supabase
      .from('works')
      .update({ payment_status: 'expired' })
      .eq('id', workId)
  } else if (type === 'transfer' && transferId && flow === 'two_phase') {
    // Sender never completed the card step — no hold was ever placed.
    // Free the work up for a new transfer attempt.
    await supabase
      .from('transfers')
      .update({ payment_status: 'expired', outcome: 'cancelled' })
      .eq('id', transferId)
  } else if (type === 'transfer' && transferId) {
    await supabase
      .from('transfers')
      .update({ payment_status: 'expired' })
      .eq('id', transferId)
  }

  console.log('Checkout session expired:', session.id)
}
