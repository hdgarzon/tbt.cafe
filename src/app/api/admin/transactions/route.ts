/**
 * Transactions — Backend Spec 07 §2.4.
 *
 * Ventas, ofertas y transferencias con el detalle completo de dinero del modelo
 * del Área 1: total del comprador, regalía, LAS DOS tarifas de servicio,
 * procesamiento y neto del vendedor, con las referencias de Stripe.
 *
 * El desglose sale de `@/lib/fees`, el mismo módulo que usa todo el resto.
 * Una pantalla de administración con su propia aritmética sería un tercer sitio
 * donde una regla de dinero puede quedarse atrás, y el handoff cuenta que eso ya
 * pasó dos veces en este proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { transferQuote, FEE, type Royalty } from '@/lib/fees'



/**
 * El desglose de una transferencia con los nombres que la consola ya lee.
 *
 * El backend tenia su propio `money.ts`, donde esto se llamaba
 * `transferBreakdown` y devolvia `serviceFee` y `senderPays`. Ese archivo no
 * cruzo —`fees.ts` es el superconjunto— pero alli los dos campos se llaman
 * `transferFee` y `total`.
 *
 * La aritmetica sale de una sola funcion; el mapeo se queda aqui para no
 * cambiar la forma de la respuesta. Renombrarlos romperia `admin/page.tsx`
 * contra la copia del backend, que sigue sirviendo hasta el repunte.
 */
const round = (n: number) => Math.round(n * 100) / 100

function breakdown(value: number, royalty: Royalty) {
  const q = transferQuote(value, royalty, false)
  return {
    value: q.value,
    royalty: round(q.royalty),
    serviceFee: q.transferFee,
    // `transferQuote` no redondea y `transferBreakdown` si lo hacia. La consola
    // imprime estos numeros con `String()`, asi que sin esto una transferencia
    // de 1.200 muestra 35.332000000000004 donde antes mostraba 35.33.
    processing: round(q.processing),
    senderPays: round(q.total),
  }
}

export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'transactions.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  try {
    // La autorización ya se comprobó arriba. Las políticas de estas tablas están
    // escritas para el cliente final —sus propios tickets, sus propias obras— y
    // aplicadas al equipo le esconderían justo lo que tiene que ver.
    const supabase = createAdminClient()
    const url = new URL(request.url)
    const type = url.searchParams.get('type') ?? 'all'
    const status = url.searchParams.get('status')
    const personId = url.searchParams.get('personId')

    const out: Record<string, unknown> = {}

    if (type === 'all' || type === 'transfers') {
      let q = supabase
        .from('transfers')
        .select('id, work_id, from_owner_id, transfer_type, sale_price, royalty_amount, royalty_paid, status, payment_status, outcome, stripe_checkout_session_id, stripe_payment_intent_id, initiated_at, completed_at, work:works(tbt_id, title)')
        .order('initiated_at', { ascending: false })
        .limit(50)
      if (status) q = q.eq('status', status)
      if (personId) q = q.eq('from_owner_id', personId)

      const { data } = await q
      out.transfers = (data ?? []).map((t) => {
        const w = Array.isArray(t.work) ? t.work[0] : t.work
        return {
          id: t.id,
          tbtId: w?.tbt_id ?? null,
          title: w?.title ?? null,
          type: t.transfer_type,
          status: t.status,
          paymentStatus: t.payment_status,
          outcome: t.outcome,
          royaltyPaid: t.royalty_paid,
          // El importe de regalía ya viene resuelto y guardado en la fila.
          money: breakdown(Number(t.sale_price ?? 0), { type: 'fixed', value: Number(t.royalty_amount ?? 0) }),
          stripe: {
            session: t.stripe_checkout_session_id,
            paymentIntent: t.stripe_payment_intent_id,
          },
          initiatedAt: t.initiated_at,
          completedAt: t.completed_at,
        }
      })
    }

    if (type === 'all' || type === 'offers') {
      let q = supabase
        .from('offers')
        .select('id, work_id, from_user, amount, currency, status, solicited, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (status) q = q.eq('status', status)
      if (personId) q = q.eq('from_user', personId)
      const { data } = await q
      out.offers = data ?? []
    }

    if (type === 'all' || type === 'registrations') {
      let q = supabase
        .from('tbt_payments')
        .select('id, work_id, user_id, amount, currency, status, stripe_checkout_session_id, stripe_payment_intent_id, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (status) q = q.eq('status', status)
      if (personId) q = q.eq('user_id', personId)
      const { data } = await q
      out.registrations = data ?? []
    }

    return NextResponse.json({
      ...out,
      // El modelo vigente, en la respuesta, para que la pantalla no reimplemente
      // ni reafirme cifras por su cuenta.
      model: {
        serviceFee: FEE.service,
        chargedOnBothSides: true,
        platformPerSale: FEE.service * 2,
        processing: `(royalty + ${FEE.service}) x ${FEE.stripePct} + ${FEE.stripeFlat}`,
        processingBorneBy: 'seller',
      },
      // Las ventas directas aún no tienen su propia tabla: viven como
      // transferencias con precio. Se dice para que nadie lea "0 ventas".
      notBuiltYet: ['standalone sales ledger', 'payout blocks'],
    })
  } catch (error) {
    console.error('[admin/transactions] failed:', error)
    return NextResponse.json({ error: 'transactions_failed' }, { status: 500 })
  }
}
