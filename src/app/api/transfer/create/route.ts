import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { enforceLadder } from '@/lib/auth-ladder-server'
import { stripe } from '@/lib/stripe'
import { transferQuote, type Royalty, type RoyaltyType } from '@/lib/fees'
import { authenticate } from '@/lib/route-auth'

/**
 * Fase 1 del transfer de dos fases (tbt.cafe Build Spec 02 / Transfer &
 * Commerce Companion): el emisor autoriza el pago, NO se cobra todavía.
 *
 * Crea la fila en `transfers` (is_two_phase, payment_status='pending',
 * to_owner_id NULL — el recipiente puede no tener cuenta aún) y una Stripe
 * Checkout Session con capture_method:'manual'. El webhook
 * (checkout.session.completed) confirma la autorización y dispara el SMS al
 * recipiente; NADA se captura hasta /api/transfer/respond con action:'accept'.
 */

const E164 = /^\+[1-9]\d{6,14}$/

export async function POST(request: NextRequest) {

  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { user } = auth

    const body = await request.json()
    const { workId, recipientPhone, recipientName, value, successUrl, cancelUrl, biometricProof, embedded = false } = body

    if (!workId || !recipientPhone || !recipientName?.trim() || value === undefined) {
      return NextResponse.json({ error: 'missingFields' }, { status: 400 })
    }
    if (!E164.test(recipientPhone)) return NextResponse.json({ error: 'invalidPhone' }, { status: 400 })
    const recordedValue = Number(value)
    if (!Number.isFinite(recordedValue) || recordedValue < 0) {
      return NextResponse.json({ error: 'invalidValue' }, { status: 400 })
    }
    /*
     * Solo se vuelve al origen propio — nunca a una URL que venga en el cuerpo
     * sin comprobar, que seria un redirect abierto con Stripe de por medio.
     *
     * Esto comparaba contra `origin` a secas, que NO esta declarado en este
     * modulo. En un navegador seria `location.origin`; en Node no existe, asi
     * que la expresion lanzaba ReferenceError, el `catch` de al lado lo volvia
     * `false`, y la comprobacion NUNCA pasaba. Ninguna transferencia podia
     * empezar: la ruta respondia 400 `invalidRedirect` incluso cuando las URLs
     * eran del mismo origen que la pagina. Compilaba porque el tsconfig incluye
     * la libreria "dom", que declara ese global sin que el runtime lo tenga.
     *
     * Es el mismo fallo que ya se corrigio en stripe/create-checkout. Aquel
     * arreglo no toco esta ruta, y aqui no degradaba: cerraba el camino entero.
     *
     * Se compara contra el origen de la propia app y NO contra la cabecera
     * `Origin`, que la elige quien llama.
     */
    const appOrigin = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').origin
      } catch {
        return null
      }
    })()

    const redirectOriginOk = (u: string) => {
      try {
        return !!appOrigin && new URL(u).origin === appOrigin
      } catch {
        return false
      }
    }
    if (!successUrl || !cancelUrl || !redirectOriginOk(successUrl) || !redirectOriginOk(cancelUrl)) {
      return NextResponse.json({ error: 'invalidRedirect' }, { status: 400 })
    }

    const service = createAdminClient()

    const { data: work, error: workError } = await service
      .from('works')
      .select('id, tbt_id, title, creator_id, current_owner_id, commerce:work_commerce(royalty_type, royalty_value, royalty_locked)')
      .eq('id', workId)
      .single()
    if (workError || !work) return NextResponse.json({ error: 'workNotFound' }, { status: 404 })
    if (work.current_owner_id !== user.id) return NextResponse.json({ error: 'notOwner' }, { status: 403 })

    const commerce = Array.isArray(work.commerce) ? work.commerce[0] : work.commerce

    /**
     * Los terminos canonicos de una regalia son `royalty_type` + `royalty_value`
     * (Spec 01, item 1). Esta ruta resolvia por la columna porcentual de la
     * migracion 008, que quedo como vestigio: en las 46 filas vivas conserva su
     * default, asi que cobraba 10% pasara lo que pasara.
     *
     * Dos formas de estar mal, y las dos cobran de verdad:
     *
     *   regalia fija        se cobraba un PORCENTAJE del valor declarado. Con
     *                       una regalia de $10 y un valor de $5.000, son $500
     *                       en vez de $10.
     *   porcentaje que no
     *   sea 10              se cobraba 10 igual. Seis obras tienen entre 5 y 20.
     *
     * El credito nunca miro esa columna: payout-earnings resuelve por
     * `royaltyAmountOf` sobre los terminos canonicos. La plataforma cobraba una
     * cifra y abonaba otra, y §2.1 existe precisamente para que ninguna ruta de
     * dinero resuelva una regalia por su cuenta.
     */
    const terms: Royalty = {
      type: (commerce?.royalty_type ?? 'none') as RoyaltyType,
      value: Number(commerce?.royalty_value ?? 0),
    }
    const senderIsCreator = work.creator_id === user.id
    const quote = transferQuote(recordedValue, terms, senderIsCreator)

    // One open two-phase transfer per work at a time (partial index enforces
    // this is cheap to check; a second authorisation on the same work before
    // the first resolves would double-hold funds against a single item).
    const { data: existing } = await service
      .from('transfers')
      .select('id')
      .eq('work_id', workId)
      .eq('is_two_phase', true)
      .eq('payment_status', 'pending')
      .is('outcome', null)
      .maybeSingle()
    if (existing) return NextResponse.json({ error: 'transferAlreadyPending' }, { status: 409 })

    const { data: senderProfile } = await service
      .from('profiles')
      .select('display_name, public_alias')
      .eq('id', user.id)
      .single()
    const fromOwnerName = senderProfile?.public_alias || senderProfile?.display_name || 'Owner'

    /**
     * La escalera — Spec 01 §5.1. Iniciar una transferencia es una acción de
     * vendedor y entra por el mismo escalón de $500 que una compra.
     *
     * SIN 3DS EN ESTA RUTA, a propósito. Va con `capture_method: 'manual'`, y
     * el §8 lista el comportamiento de 3DS bajo captura manual como pendiente
     * de verificar contra la documentación viva de Stripe. Meterlo a ciegas
     * puede romper la retención de la autorización, que es dinero real
     * retenido a alguien. El biométrico no tiene esa ambigüedad y sí se exige.
     *
     * NOTA para producto: aquí el monto lo DECLARA el emisor, no sale de la
     * base como en la compra. Declarar cero baja del umbral y evita el
     * biométrico — un secuestro de cuenta podría sacar una obra valiosa
     * declarándola regalo. El spec gatea por monto y eso es lo implementado;
     * cerrar ese hueco es una decisión de producto, emparentada con los
     * límites de velocidad del §5.5, que el §9 deja sin decidir.
     */
    const ladder = await enforceLadder({
      admin: service,
      userId: user.id,
      action: 'transfer_initiate',
      amount: recordedValue,
      workId,
      biometricProof,
    })
    if (!ladder.ok) {
      return NextResponse.json({ error: ladder.error }, { status: ladder.status })
    }

    const { data: transfer, error: insertError } = await service
      .from('transfers')
      .insert({
        work_id: workId,
        from_owner_id: user.id,
        from_owner_name: fromOwnerName,
        to_owner_id: null,
        transfer_type: recordedValue > 0 ? 'sale' : 'gift',
        new_owner_name: recipientName.trim(),
        new_owner_phone: recipientPhone,
        payment_status: 'pending',
        payment_amount: recordedValue,
        payment_currency: 'USD',
        is_two_phase: true,
      })
      .select('id')
      .single()
    if (insertError || !transfer) {
      console.error('Error creating two-phase transfer:', insertError)
      return NextResponse.json({ error: 'transferFailed' }, { status: 500 })
    }

    const lineItems: Array<{ price_data: any; quantity: number }> = [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'TBT Transfer Fee', description: work.title },
          unit_amount: Math.round(quote.transferFee * 100),
        },
        quantity: 1,
      },
    ]
    if (quote.royalty > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Creator Royalty', description: work.title },
          unit_amount: Math.round(quote.royalty * 100),
        },
        quantity: 1,
      })
    }
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Card Processing', description: work.title },
        unit_amount: Math.round(quote.processing * 100),
      },
      quantity: 1,
    })

    let session
    try {
      /**
       * Checkout embebido — Spec 01 §3.1: el emisor no sale de tbt.cafe.
       *
       * En este modo Stripe devuelve `client_secret` en vez de URL y admite un
       * solo retorno: `cancel_url` no existe, porque cerrar el sheet ES la
       * cancelación. `successUrl` ya viene validado contra el origen permitido
       * más arriba, así que sirve de `return_url` sin más comprobaciones.
       *
       * La captura manual se mantiene: esta ruta es la transferencia de dos
       * fases y el dinero se retiene hasta que la contraparte acepta.
       */
      const commonParams = {
        mode: 'payment' as const,
        payment_method_types: ['card' as const],
        line_items: lineItems,
        payment_intent_data: { capture_method: 'manual' as const },
        metadata: {
          type: 'transfer',
          flow: 'two_phase',
          transferId: transfer.id,
          workId,
        },
      }

      session = embedded
        ? await stripe.checkout.sessions.create({
            ...commonParams,
            ui_mode: 'embedded_page',
            return_url: successUrl,
          })
        : await stripe.checkout.sessions.create({
            ...commonParams,
            success_url: successUrl,
            cancel_url: cancelUrl,
          })
    } catch (stripeError) {
      console.error('Error creating two-phase checkout session:', stripeError)
      // No PaymentIntent exists yet — safe to just drop the row rather than
      // leave an orphaned transfer with nothing behind it to cancel later.
      await service.from('transfers').delete().eq('id', transfer.id)
      return NextResponse.json({ error: 'transferFailed' }, { status: 500 })
    }

    await service
      .from('transfers')
      .update({ stripe_checkout_session_id: session.id, payment_link: session.url })
      .eq('id', transfer.id)

    return NextResponse.json({
      // Embebido: no hay URL, el formulario se monta con el client_secret.
      clientSecret: session.client_secret,
      checkoutUrl: session.url,
      transferId: transfer.id,
    })
  } catch (error) {
    console.error('Error in /api/transfer/create:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
