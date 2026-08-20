import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession, stripe, type CheckoutType } from '@/lib/stripe'
import { SERVICE_FEE_CENTS, royaltyAmountOf, type RoyaltyType } from '@/lib/fees'
import { trackProvider } from '@/lib/provider-events'
import { authenticate } from '@/lib/route-auth'


export async function POST(request: NextRequest) {

  try {
    const {
      type,
      workId,
      transferId,
      successUrl: successUrlIn,
      cancelUrl: cancelUrlIn,
      couponCode,
      returnUrl: returnUrlIn,
      embedded = false,
    } = await request.json() as {
      type: CheckoutType
      workId: string
      transferId?: string
      successUrl?: string
      cancelUrl?: string
      /** Checkout embebido (Spec 01 §3.1): una sola URL de retorno. */
      couponCode?: string
      returnUrl?: string
      embedded?: boolean
    }

    if (!type || !workId) {
      return NextResponse.json(
        { error: 'type and workId are required' },
        { status: 400 }
      )
    }

    if (!['tbt_creation', 'transfer'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid payment type' },
        { status: 400 }
      )
    }

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    // Ownership checks and server-side royalty calculation
    let royaltyAmount: number | undefined

    if (type === 'tbt_creation') {
      const { data: work, error: workError } = await supabase
        .from('works')
        .select('id, creator_id, context_data')
        .eq('id', workId)
        .single()

      if (workError || !work) {
        return NextResponse.json({ error: 'Work not found' }, { status: 404 })
      }

      if (work.creator_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      /**
       * Ventana de pago. El sellado congela precio, regalías, contexto y el
       * resultado del escaneo en un instante concreto, y esos datos quedan en
       * un certificado permanente. Si el pago llega días después, el
       * certificado afirmaría un "Moment in Time" que ya no corresponde. Al
       * vencer, el borrador NO se pierde: hay que volver a sellarlo, lo que
       * recaptura los anclajes.
       */
      const expiresAt = (work.context_data as { paymentWindowExpiresAt?: string } | null)
        ?.paymentWindowExpiresAt
      if (expiresAt && Date.now() > Date.parse(expiresAt)) {
        return NextResponse.json(
          { error: 'payment_window_expired', message: 'El sello venció. Vuelve a sellar la obra para registrarla.' },
          { status: 409 }
        )
      }
    } else if (type === 'transfer') {
      if (!transferId) {
        return NextResponse.json({ error: 'transferId is required for transfer type' }, { status: 400 })
      }

      const { data: transfer, error: transferError } = await supabase
        .from('transfers')
        .select('id, from_owner_id, work_id')
        .eq('id', transferId)
        .single()

      if (transferError || !transfer) {
        return NextResponse.json({ error: 'Transfer not found' }, { status: 404 })
      }

      if (transfer.from_owner_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Compute royalty server-side from work_commerce
      const { data: commerce } = await supabase
        .from('work_commerce')
        .select('royalty_type, royalty_value, initial_price, currency')
        .eq('work_id', transfer.work_id)
        .single()

      // Ninguna ruta de dinero calcula valor x pct por su cuenta (Spec 01 §2.1):
      // todas pasan por royaltyAmountOf.
      if (commerce) {
        royaltyAmount = royaltyAmountOf(
          { type: (commerce.royalty_type ?? 'none') as RoyaltyType, value: Number(commerce.royalty_value ?? 0) },
          Number(commerce.initial_price ?? 0)
        )
      }
    }

    // Generate URLs. Cross-origin callers (tbt.cafe) pass their own
    // successUrl/cancelUrl so Stripe redirects back to THEM, not to Forms —
    // only honoured when it's the same already-CORS-allowlisted origin this
    // request came from, so a caller can't redirect Stripe anywhere else.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const sameOrigin = (u: string) => {
      try {
        return !!origin && new URL(u).origin === origin
      } catch {
        return false
      }
    }
    const successUrl =
      successUrlIn && sameOrigin(successUrlIn)
        ? successUrlIn
        : `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=${type}&workId=${workId}${transferId ? `&transferId=${transferId}` : ''}`
    const cancelUrl =
      cancelUrlIn && sameOrigin(cancelUrlIn) ? cancelUrlIn : `${baseUrl}/payment/cancel?type=${type}&workId=${workId}`
    // Misma regla que arriba: solo se honra si es el origen ya permitido por
    // CORS del que vino la petición, para que nadie redirija Stripe a otro sitio.
    const returnUrl =
      returnUrlIn && sameOrigin(returnUrlIn)
        ? returnUrlIn
        : `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=${type}&workId=${workId}`

    /**
     * Descuento — §1A.1: "un descuento cambia el importe, no la etiqueta".
     *
     * El código se resuelve AQUÍ contra Stripe y se pasa a la sesión, para que
     * el descuento lo aplique Stripe y el importe se calcule una sola vez. La
     * alternativa —restarlo en la pantalla y volver a calcularlo en el
     * servidor— es exactamente cómo nació el bug que el spec deja registrado:
     * el botón decía "Pagar $4" y el manejador cobraba $8.
     *
     * Un código que no resuelve NO se ignora: se rechaza. Cobrar el importe
     * completo después de anunciar un descuento es el fallo que esto cierra.
     */
    let promotionCodeId: string | undefined
    if (couponCode) {
      const found = await stripe.promotionCodes.list({
        code: String(couponCode).trim().toUpperCase(),
        active: true,
        limit: 1,
      })
      promotionCodeId = found.data[0]?.id
      if (!promotionCodeId) {
        return NextResponse.json({ error: 'invalid_coupon' }, { status: 400 })
      }
    }

    // Create Stripe checkout session
    const session = await trackProvider(
      { provider: 'stripe', operation: 'create_checkout', entityType: 'work', entityId: workId },
      () => createCheckoutSession({
      type,
      workId,
      userId: user.id,
      successUrl,
      cancelUrl,
      transferId,
      royaltyAmount,
      embedded,
      returnUrl,
      promotionCodeId,
      })
    )

    // Store payment record
    if (type === 'tbt_creation') {
      await supabase.from('tbt_payments').insert({
        work_id: workId,
        user_id: user.id,
        amount: SERVICE_FEE_CENTS / 100,
        currency: 'USD',
        stripe_checkout_session_id: session.id,
        status: 'pending',
      })

      await supabase
        .from('works')
        .update({ payment_status: 'pending', payment_intent_id: session.id })
        .eq('id', workId)
    } else if (type === 'transfer' && transferId) {
      await supabase
        .from('transfers')
        .update({
          payment_status: 'pending',
          // En modo embebido no hay URL que guardar; el pago ocurre en la página.
          payment_link: session.url ?? null,
          stripe_checkout_session_id: session.id,
        })
        .eq('id', transferId)
    }

    return NextResponse.json({
      // En modo embebido Stripe no devuelve URL: el cliente monta el formulario
      // con el client_secret y nunca sale de tbt.cafe.
      clientSecret: session.client_secret,
      checkoutUrl: session.url,
      sessionId: session.id,
    })
  } catch (error: any) {
    console.error('Error creating checkout session:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
