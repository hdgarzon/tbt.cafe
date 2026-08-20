import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession } from '@/lib/stripe'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { enforceLadder } from '@/lib/auth-ladder-server'

/**
 * POST /api/stripe/create-purchase — compra iniciada por el COMPRADOR desde
 * la página pública /work/[tbtId] (Master Handoff §2, Build Spec 01 §2 "REUSE
 * — EXISTING WORK PAGE BACKEND").
 *
 * Ruta NUEVA y separada de /api/stripe/create-checkout a propósito: esta
 * última solo soporta creación (creator paga su propia certificación) y
 * transferencia vendedor-iniciada con un transferId ya existente. No existía
 * ningún camino para que un comprador nuevo arrancara una compra desde cero
 * — se construye aquí en vez de modificar esa ruta, para no arriesgar los
 * flujos de pago que ya están en producción.
 *
 * Modelo de cobro (decisión de negocio, no supuesto): igual que la
 * transferencia vendedor-iniciada de /transferir — se cobra la tarifa de
 * plataforma ($8) + la regalía del artista, ambas vía Stripe. El precio de la
 * obra (work_commerce.initial_price) se registra como referencia en
 * transfers.sale_price, pero el intercambio de ese monto ocurre FUERA de la
 * plataforma entre comprador y vendedor — no hay infraestructura de payout
 * (Stripe Connect u otra) para que la plataforma retenga y reparta el precio
 * completo. El copy de /work/[tbtId] debe dejar esto claro al comprador.
 */

export async function POST(request: NextRequest) {

  try {
    const { workId, biometricProof, embedded = false } = await request.json()

    if (!workId) {
      return NextResponse.json({ error: 'workId is required' }, { status: 400 })
    }

    // successUrl/cancelUrl se construyen server-side desde el Origin YA
    // validado contra la allowlist — nunca desde un valor que mande el
    // cliente, para no abrir una superficie de open-redirect.
    if (!origin) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
    }

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    // Obra: debe existir, estar certificada, y no ser ya propiedad del comprador
    const { data: work, error: workError } = await supabase
      .from('works')
      .select('id, tbt_id, status, current_owner_id')
      .eq('id', workId)
      .single()

    if (workError || !work) {
      return NextResponse.json({ error: 'Work not found' }, { status: 404 })
    }
    if (work.status !== 'certified') {
      return NextResponse.json({ error: 'This work is not certified' }, { status: 400 })
    }
    if (work.current_owner_id === user.id) {
      return NextResponse.json({ error: 'You already own this work' }, { status: 400 })
    }

    // Comercio: debe estar a la venta con un precio válido
    const { data: commerce, error: commerceError } = await supabase
      .from('work_commerce')
      .select('initial_price, currency, royalty_type, royalty_value, is_for_sale')
      .eq('work_id', workId)
      .single()

    if (commerceError || !commerce || !commerce.is_for_sale || !commerce.initial_price || commerce.initial_price <= 0) {
      return NextResponse.json({ error: 'This work is not for sale' }, { status: 400 })
    }

    // Regalía server-side — misma lógica que create-checkout para type='transfer'
    let royaltyAmount: number | undefined
    if (commerce.royalty_type === 'percentage' && commerce.royalty_value > 0) {
      royaltyAmount = (commerce.initial_price * commerce.royalty_value) / 100
    } else if (commerce.royalty_type === 'fixed' && commerce.royalty_value > 0) {
      royaltyAmount = commerce.royalty_value
    }

    /**
     * La escalera — Spec 01 §5.1. Va aquí, después de leer el precio de la
     * base y antes de crear la fila de transferencia: fallar más adelante
     * dejaría una compra a medio empezar por una comprobación que se podía
     * hacer antes.
     *
     * El monto es `commerce.initial_price`, leído arriba. Nunca el del cliente.
     */
    const ladder = await enforceLadder({
      admin: createAdminClient(),
      userId: user.id,
      action: 'purchase',
      amount: commerce.initial_price,
      workId,
      biometricProof,
    })
    if (!ladder.ok) {
      return NextResponse.json({ error: ladder.error }, { status: ladder.status })
    }

    // Insert con la sesión del COMPRADOR (no service-role): la RLS
    // "Users can create transfers" exige with_check to_owner_id = auth.uid(),
    // así que la propia base de datos verifica que nadie inserte una fila de
    // compra a nombre de otro usuario — defensa en profundidad.
    const { data: newTransfer, error: transferError } = await supabase
      .from('transfers')
      .insert({
        work_id: workId,
        from_owner_id: work.current_owner_id,
        to_owner_id: user.id,
        transfer_type: 'automatic',
        sale_price: commerce.initial_price,
        royalty_amount: royaltyAmount ?? null,
        status: 'payment_pending',
      })
      .select('id')
      .single()

    if (transferError || !newTransfer) {
      return NextResponse.json(
        { error: transferError?.message ?? 'Could not start the purchase' },
        { status: 500 }
      )
    }

    const successUrl = `${origin}/purchase/success?session_id={CHECKOUT_SESSION_ID}&transferId=${newTransfer.id}&workId=${workId}`
    const cancelUrl = `${origin}/purchase/cancel?workId=${workId}`

    /**
     * Checkout embebido — Backend Spec 01 §3.1: el comprador no sale de
     * tbt.cafe. Stripe devuelve un `client_secret` en vez de una URL y el
     * retorno es uno solo; `cancel_url` no existe en este modo, porque cerrar
     * el sheet ES la cancelación.
     *
     * El retorno se construye AQUÍ, desde el `origin` ya validado contra la
     * allowlist, y no se acepta ninguna URL del cliente — misma razón que
     * successUrl/cancelUrl: no abrir una superficie de open-redirect.
     */
    const returnUrl = successUrl

    const session = await createCheckoutSession({
      type: 'transfer',
      workId,
      userId: user.id,
      successUrl,
      cancelUrl,
      transferId: newTransfer.id,
      royaltyAmount,
      requireThreeDS: ladder.requireThreeDS,
      embedded,
      returnUrl,
    })

    await supabase
      .from('transfers')
      .update({
        stripe_checkout_session_id: session.id,
        payment_link: session.url,
      })
      .eq('id', newTransfer.id)

    return NextResponse.json({
      // En modo embebido Stripe no devuelve URL: el cliente monta el
      // formulario con el client_secret y el 3D Secure ocurre dentro del
      // iframe, que Stripe resuelve antes de volver a `return_url`.
      clientSecret: session.client_secret,
      checkoutUrl: session.url,
      sessionId: session.id,
      transferId: newTransfer.id,
    })
  } catch (error: any) {
    console.error('Error creating purchase checkout session:', error)
    return NextResponse.json(
      { error: 'Failed to create purchase checkout session' },
      { status: 500 }
    )
  }
}
