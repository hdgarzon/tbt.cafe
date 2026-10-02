import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { handleStripeEvent } from '@/lib/stripe-events'

/**
 * POST /api/stripe/connect-webhook — los eventos de las cuentas conectadas
 * (Work Order 02, 0.3c): la compra por la via directa se cobra en la cuenta del
 * vendedor, asi que su checkout.session.completed, sus disputas y sus
 * reembolsos llegan aqui, con `event.account` puesto.
 *
 * Firma propia (STRIPE_CONNECT_WEBHOOK_SECRET) y los mismos manejadores que el
 * webhook de la plataforma: nada se escribe dos veces.
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!signature || !secret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.error('Connect webhook signature verification failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  const result = await handleStripeEvent(event, event.account ?? null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ received: true })
}
