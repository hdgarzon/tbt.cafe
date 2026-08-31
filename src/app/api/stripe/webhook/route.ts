import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase-admin'
import Stripe from 'stripe'
import { describeDisputeEvent } from '@/lib/disputes'

/**
 * El cliente de service-role, construido en el primer uso y no al importar.
 *
 * Este modulo lanzaba en su cuerpo si faltaba `SUPABASE_SERVICE_ROLE_KEY`, y
 * construia el cliente ahi mismo. Ninguna de las dos cosas espera a que llegue
 * una peticion: pasan al IMPORTAR, y Next importa cada ruta al construir para
 * recoger los datos de pagina. Sin la variable, el build entero se cae:
 *
 *   Error: SUPABASE_SERVICE_ROLE_KEY is required for the Stripe webhook
 *   Failed to collect page data for /api/stripe/webhook
 *
 * Es lo que tuvo los previews de este repo en rojo — el entorno Preview no
 * lleva claves de servidor, y no deberia llevarlas: un preview con la clave que
 * se salta la RLS es una superficie que no se quiere. `lib/stripe.ts` ya se
 * arreglo por esto mismo; esta ruta se quedo atras.
 *
 * Perezoso, una ruta sin clave devuelve un 500 legible cuando alguien la llama,
 * y el resto del despliegue sigue en pie.
 *
 * La excepcion legitima es `lib/supabase.ts`: sus variables son `NEXT_PUBLIC_*`
 * y se incrustan AL CONSTRUIR, asi que si faltan la aplicacion no puede
 * funcionar en el navegador y caerse en el build es exactamente lo correcto.
 * La regla no es «nunca lances al importar», es «no lances por un secreto de
 * tiempo de ejecucion».
 */
let client: ReturnType<typeof createAdminClient> | null = null
const db = () => (client ??= createAdminClient())

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
    /*
     * La plataforma es el comercio de registro de todos los cargos, asi que
     * cada disputa y cada reembolso salen de su saldo. Hasta ahora los tres
     * caian en el `default` de abajo y no dejaban rastro en ninguna parte.
     *
     * No se congela ni se revierte nada: eso lo decide quien lleva el negocio.
     * Aqui solo dejan de ser invisibles.
     */
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
    case 'charge.refunded': {
      const stored = await recordDispute(event)
      /*
       * El resto de esta ruta devuelve 200 pase lo que pase y se traga los
       * errores de escritura, asi que Stripe no reintenta nunca. Para una
       * disputa eso volveria a perderla, que es justo lo que se esta
       * arreglando: si no se pudo guardar, se pide el reenvio.
       */
      if (!stored) {
        return NextResponse.json({ error: 'dispute_not_recorded' }, { status: 500 })
      }
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
    const { error: paymentError } = await db()
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
    const { error: workError } = await db()
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
    const { error: transferError } = await db()
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
    const { error: transferError } = await db()
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
    const { data: transfer } = await db()
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
    await db()
      .from('tbt_payments')
      .update({ status: 'expired' })
      .eq('stripe_checkout_session_id', session.id)

    await db()
      .from('works')
      .update({ payment_status: 'expired' })
      .eq('id', workId)
  } else if (type === 'transfer' && transferId && flow === 'two_phase') {
    // Sender never completed the card step — no hold was ever placed.
    // Free the work up for a new transfer attempt.
    await db()
      .from('transfers')
      .update({ payment_status: 'expired', outcome: 'cancelled' })
      .eq('id', transferId)
  } else if (type === 'transfer' && transferId) {
    await db()
      .from('transfers')
      .update({ payment_status: 'expired' })
      .eq('id', transferId)
  }

  console.log('Checkout session expired:', session.id)
}

/**
 * La busqueda inversa, que no es una sino cuatro.
 *
 * Un `pi_…` puede estar guardado en tres columnas de dos tablas segun por que
 * flujo entro el pago: `tbt_payments` es un libro solo de registros y no tiene
 * columna de transferencia, y el intent de una transferencia cae en
 * `stripe_payment_intent_id` o en `payment_reference` segun sea de dos fases o
 * del flujo antiguo.
 *
 * Y para algunos pagos no esta en ninguna. Un registro reconciliado sin
 * webhook —el camino de respaldo de `complete-tbt`— deja la suya en NULL.
 * Devolver nulos es un resultado legitimo: la disputa se guarda igual.
 */
async function resolvePayment(paymentIntentId: string | null): Promise<{
  workId: string | null
  transferId: string | null
  userId: string | null
}> {
  const unresolved = { workId: null, transferId: null, userId: null }
  if (!paymentIntentId) return unresolved

  const { data: payment } = await db()
    .from('tbt_payments')
    .select('work_id, user_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (payment?.work_id) {
    return { workId: payment.work_id, transferId: null, userId: payment.user_id ?? null }
  }

  // Quien paga una transferencia es quien la envia: `transfer/create` abre la
  // sesion con el usuario autenticado y lo guarda como `from_owner_id`.
  for (const column of ['stripe_payment_intent_id', 'payment_reference'] as const) {
    const { data: transfer } = await db()
      .from('transfers')
      .select('id, work_id, from_owner_id')
      .eq(column, paymentIntentId)
      .maybeSingle()

    if (transfer) {
      return {
        workId: transfer.work_id ?? null,
        transferId: transfer.id,
        userId: transfer.from_owner_id ?? null,
      }
    }
  }

  const { data: work } = await db()
    .from('works')
    .select('id, creator_id')
    .eq('payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (work) return { workId: work.id, transferId: null, userId: work.creator_id ?? null }

  /*
   * La sesion, que es lo unico que si esta siempre.
   *
   * De 23 pagos de registro solo 4 tienen el intent guardado: la ruta que los
   * reconcilia sin webhook escribe `payment_status` y nada mas. Y
   * `works.payment_intent_id` guarda un `cs_…` en 17 filas de 58, asi que la
   * comparacion de arriba tampoco las alcanza. Sin este paso, la mayoria de
   * las disputas de registro quedarian sin resolver.
   *
   * La sesion ademas trae los metadatos que el webhook ya usa para todo lo
   * demas, de modo que una sola llamada da obra, persona y transferencia.
   */
  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    })

    const session = sessions.data[0]
    if (session) {
      const meta = session.metadata ?? {}
      if (meta.workId || meta.transferId) {
        return {
          workId: meta.workId ?? null,
          transferId: meta.transferId ?? null,
          userId: meta.userId ?? null,
        }
      }

      // Sin metadatos, todavia queda el propio id de la sesion: es lo que
      // `tbt_payments` guarda siempre, y lo que `works` guarda a veces.
      const { data: bySession } = await db()
        .from('tbt_payments')
        .select('work_id, user_id')
        .eq('stripe_checkout_session_id', session.id)
        .maybeSingle()

      if (bySession?.work_id) {
        return { workId: bySession.work_id, transferId: null, userId: bySession.user_id ?? null }
      }

      const { data: workBySession } = await db()
        .from('works')
        .select('id, creator_id')
        .eq('payment_intent_id', session.id)
        .maybeSingle()

      if (workBySession) {
        return { workId: workBySession.id, transferId: null, userId: workBySession.creator_id ?? null }
      }
    }
  } catch (err) {
    // Que Stripe no conteste no puede impedir guardar la disputa.
    console.error('[webhook] no se pudo buscar la sesion del pago:', err)
  }

  return unresolved
}

/**
 * Guarda la disputa. No toca dinero y no le escribe a nadie.
 *
 * Devuelve si quedo guardada, porque de eso depende que se le pida a Stripe
 * el reenvio.
 */
async function recordDispute(event: Stripe.Event): Promise<boolean> {
  const described = describeDisputeEvent(event as unknown as { type: string; data: { object: unknown } })

  if (!described) {
    // Un evento de esta familia que no se deja leer es un cambio de forma en
    // la API, no un fallo transitorio: reintentarlo daria igual.
    console.error(`[webhook] evento de disputa ilegible: ${event.type} ${event.id}`)
    return true
  }

  const resolved = await resolvePayment(described.paymentIntentId)

  const row: Record<string, unknown> = {
    provider_ref: described.providerRef,
    kind: described.kind,
    charge_id: described.chargeId,
    payment_intent_id: described.paymentIntentId,
    status: described.status,
    amount: described.amount,
    currency: described.currency,
    reason: described.reason,
    raw: event as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }

  // Lo resuelto solo viaja si se resolvio. En un `closed` cuya busqueda
  // inversa no encuentre nada, omitirlo conserva lo que la apertura ya habia
  // guardado en vez de borrarlo.
  if (resolved.workId) row.work_id = resolved.workId
  if (resolved.transferId) row.transfer_id = resolved.transferId
  if (resolved.userId) row.subject_user = resolved.userId

  const { error } = await db()
    .from('payment_disputes')
    .upsert(row, { onConflict: 'provider_ref' })

  if (error) {
    console.error(`[webhook] no se pudo guardar ${described.providerRef}:`, error)
    return false
  }

  console.error(
    `[webhook] ${described.kind} ${described.providerRef} — ${described.amount} ${described.currency.toUpperCase()}` +
      (resolved.workId ? ` sobre la obra ${resolved.workId}` : ' SIN RESOLVER a ninguna obra')
  )

  return true
}
