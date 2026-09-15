import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe'
import { notify } from '@/lib/notify'

/**
 * El barrido diario de las transferencias que nadie respondió — Transfer
 * Companion, "24 HOURS IS NOT ARBITRARY".
 *
 * Una transferencia de dos fases retiene la tarjeta de quien envía hasta que el
 * destinatario responde, y vence a las 24 horas. Hasta ahora solo vencía cuando
 * el destinatario intentaba responder tarde (/api/transfer/respond). Si no lo
 * intentaba nunca:
 *
 *  - la retención seguía en la tarjeta hasta que Stripe la soltara sola, días
 *    después;
 *  - nadie le decía a quien envió que la transferencia no siguió;
 *  - y la obra no se podía volver a enviar: /api/transfer/create ve una abierta
 *    y responde `transferAlreadyPending`.
 *
 * El orden es el de /api/transfer/cancel: primero se suelta la retención,
 * después se marca. Dar por vencida una transferencia con el dinero todavía
 * retenido es la versión del error que nadie va a mirar.
 */

export const HOLD_WINDOW_MS = 24 * 3600 * 1000

const BATCH = 100

type WorkRef = { title: string | null; tbt_id: string | null }

type OpenTransfer = {
  id: string
  from_owner_id: string | null
  stripe_payment_intent_id: string | null
  stripe_checkout_session_id: string | null
  work: WorkRef | WorkRef[] | null
}

export async function lapseUnansweredTransfers(
  admin: SupabaseClient
): Promise<{ checked: number; lapsed: number; skipped: number }> {
  const cutoff = new Date(Date.now() - HOLD_WINDOW_MS).toISOString()

  const { data, error } = await admin
    .from('transfers')
    .select('id, from_owner_id, stripe_payment_intent_id, stripe_checkout_session_id, work:works(title, tbt_id)')
    .eq('is_two_phase', true)
    .eq('payment_status', 'pending')
    .is('outcome', null)
    .not('authorized_at', 'is', null)
    .lt('authorized_at', cutoff)
    .order('authorized_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[transfer-lapse] could not read open transfers:', error)
    return { checked: 0, lapsed: 0, skipped: 0 }
  }

  const open = (data ?? []) as OpenTransfer[]
  let lapsed = 0
  let skipped = 0

  for (let i = 0; i < open.length; i++) {
    const t = open[i]

    const released = await releaseHold(t)
    if (!released) {
      skipped++
      continue
    }

    /*
     * Condicional: si entre la lectura y aquí alguien respondió o canceló, la
     * fila ya no está abierta y no se pisa. Solo avisa la pasada que la marcó.
     */
    const { data: marked, error: markError } = await admin
      .from('transfers')
      .update({ payment_status: 'expired', outcome: 'lapsed' })
      .eq('id', t.id)
      .eq('payment_status', 'pending')
      .is('outcome', null)
      .select('id')

    if (markError) {
      console.error(`[transfer-lapse] ${t.id}: hold released but the row was not marked:`, markError)
    }
    if (!marked?.length) {
      skipped++
      continue
    }
    lapsed++

    if (!t.from_owner_id) continue
    const work = Array.isArray(t.work) ? t.work[0] : t.work
    await notify(admin, {
      userId: t.from_owner_id,
      eventKey: 'transfers',
      // La misma clave que respond: una transferencia vence una sola vez.
      dedupeKey: `${t.id}:lapsed`,
      data: { variant: 'lapsed', title: work?.title ?? '' },
      href: work?.tbt_id ? `/work/${work.tbt_id}` : undefined,
    })
  }

  return { checked: open.length, lapsed, skipped }
}

/** Suelta la retención. Devuelve true solo si consta que ya no queda dinero retenido. */
async function releaseHold(t: OpenTransfer): Promise<boolean> {
  let intentId = t.stripe_payment_intent_id

  // El id lo escribe el webhook y puede faltar si llegó tarde. La sesión de
  // checkout existe desde que se creó la transferencia.
  if (!intentId && t.stripe_checkout_session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(t.stripe_checkout_session_id)
      intentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent?.id ?? null)
    } catch (lookupError) {
      console.error(`[transfer-lapse] ${t.id}: could not read the checkout session:`, lookupError)
    }
  }

  if (!intentId) {
    /*
     * Consta que se autorizó y no hay qué soltar. Se deja abierta, como hace
     * cancel: marcarla vencida dejaría una retención huérfana que nadie busca.
     */
    console.error(`[transfer-lapse] ${t.id}: authorized but no PaymentIntent to release`)
    return false
  }

  try {
    await stripe.paymentIntents.cancel(intentId)
    return true
  } catch (stripeError: any) {
    if (stripeError?.code === 'payment_intent_unexpected_state') {
      /*
       * Ya no se puede cancelar. Si es porque ya estaba cancelada —Stripe suelta
       * sola una autorización a los pocos días—, está suelta. Si es porque se
       * capturó, alguien aceptó y complete-transfer va en camino: no es nuestra.
       */
      try {
        const intent = await stripe.paymentIntents.retrieve(intentId)
        return intent.status === 'canceled'
      } catch (retrieveError) {
        console.error(`[transfer-lapse] ${t.id}: could not read the PaymentIntent:`, retrieveError)
        return false
      }
    }
    console.error(`[transfer-lapse] ${t.id}: could not release the hold:`, stripeError)
    return false
  }
}
