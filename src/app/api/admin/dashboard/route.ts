/**
 * Dashboard — Backend Spec 07 §2.1.
 *
 * El estado del negocio AHORA. No es un informe: es un tablero de estado, y por
 * eso lo que está fallando aparece aquí y no enterrado en Observabilidad. Quien
 * abre esto por la mañana debe ver en la primera pantalla si algo se rompió
 * durante la noche.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'


const DAY = 86_400_000
const since = (days: number) => new Date(Date.now() - days * DAY).toISOString()

export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'dashboard.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  try {
  // La autorización ya se comprobó arriba. Las políticas de estas tablas están
    // escritas para el cliente final —sus propios tickets, sus propias obras— y
    // aplicadas al equipo le esconderían justo lo que tiene que ver.
    const supabase = createAdminClient()
  const count = (table: string) =>
    supabase.from(table).select('id', { count: 'exact', head: true })

  const [
    regToday,
    reg7,
    reg30,
    transfers30,
    offersOpen,
    ticketsFinancial,
    ticketsSecondary,
    chainPending,
    mmsFailed,
    coveredTotal,
    approvalsPending,
  ] = await Promise.all([
    count('works').eq('status', 'certified').gte('created_at', since(1)),
    count('works').eq('status', 'certified').gte('created_at', since(7)),
    count('works').eq('status', 'certified').gte('created_at', since(30)),
    count('transfers').gte('initiated_at', since(30)),
    count('offers').eq('status', 'open'),
    count('tickets').eq('severity', 'financial').in('status', ['open', 'answered']),
    count('tickets').eq('severity', 'secondary').in('status', ['open', 'answered']),
    // Atraso de escritura en cadena: certificada pero sin minteo confirmado.
    count('works').eq('status', 'certified').is('mint_address', null),
    count('works').eq('mms_delivery_status', 'failed'),
    count('covered_registrations'),
    count('admin_pending_approvals').eq('status', 'pending'),
  ])

  const failing: Array<{ what: string; count: number; where: string }> = []
  if ((chainPending.count ?? 0) > 0) {
    failing.push({ what: 'Registrations without a confirmed chain write', count: chainPending.count!, where: 'works' })
  }
  if ((mmsFailed.count ?? 0) > 0) {
    // Alguien pagó y no recibió el certificado. Es lo primero que hay que ver.
    failing.push({ what: 'Certificate deliveries that failed', count: mmsFailed.count!, where: 'works' })
  }
  if ((ticketsFinancial.count ?? 0) > 0) {
    failing.push({ what: 'Open requests touching money', count: ticketsFinancial.count!, where: 'tickets' })
  }

  return NextResponse.json({
    registrations: { today: regToday.count ?? 0, last7: reg7.count ?? 0, last30: reg30.count ?? 0 },
    transfers30: transfers30.count ?? 0,
    offersOpen: offersOpen.count ?? 0,
    tickets: { financial: ticketsFinancial.count ?? 0, secondary: ticketsSecondary.count ?? 0 },
    // El coste asumido a la fecha, en el tablero, porque la exposición del
    // programa no tiene tope y conviene mirarla sin ir a buscarla (§2.8).
    coveredRegistrations: coveredTotal.count ?? 0,
    approvalsPending: approvalsPending.count ?? 0,
    failing,
    // Payouts todavía no existen: se dice, en vez de mostrar ceros que se leen
    // como "nada pendiente".
    notBuiltYet: ['payouts', 'arweave', 'bitcoin anchors'],
  })
  } catch (error) {
    console.error('[admin/dashboard] failed:', error)
    return NextResponse.json({ error: 'dashboard_failed' }, { status: 500 })
  }
}
