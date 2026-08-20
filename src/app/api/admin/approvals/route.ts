/**
 * Aprobaciones de dos personas — Backend Spec 07 §1.3.
 *
 * Quien aprueba nunca es quien inició, y eso se comprueba en la base de datos
 * mediante `admin_resolve_approval`, no aquí: una comprobación en la ruta se
 * puede rodear llamando a otra, una en la función no.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'


export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'dashboard.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  const { data, error } = await createAdminClient()
    .from('admin_pending_approvals')
    .select('id, action, entity_type, entity_id, payload, reason, initiator_id, status, expires_at, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    approvals: data ?? [],
    // La interfaz necesita saber si esta persona puede aprobar y, sobre todo,
    // que no puede aprobar lo suyo.
    canApprove: can(admin, 'approve_high_risk'),
    me: admin?.userId ?? null,
  })
}

export async function POST(request: NextRequest) {

  try {
    const { approvalId, decision } = (await request.json()) as {
      approvalId?: string
      decision?: 'approved' | 'rejected'
    }
    if (!approvalId || !decision) return NextResponse.json({ error: 'approvalId and decision required' }, { status: 400 })

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

    const admin = await loadAdmin(auth.supabase, auth.user.id)
    if (!can(admin, 'approve_high_risk')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Aprobar es de alto riesgo por definición: se revalida el step-up (§1.4).
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    // ESTA va con el token de la persona a propósito: la función deriva quién
    // aprueba de auth.uid(), que es lo que impide aprobar en nombre de otro.
    const { data, error } = await auth.supabase.rpc('admin_resolve_approval', {
      approval_id: approvalId,
      decision,
    })

    // La función levanta excepción si quien aprueba es quien inició, si le
    // falta la capacidad o si la solicitud ya no está viva. Se devuelve tal
    // cual: son negativas legítimas, no fallos.
    if (error) return NextResponse.json({ error: error.message }, { status: 409 })

    await writeAudit(auth.supabase, request, {
      actor: admin!,
      approverId: admin!.userId,
      action: `approval.${decision}`,
      entityType: 'approval',
      entityId: approvalId,
      after: data,
    })

    return NextResponse.json({ ok: true, approval: data })
  } catch (error) {
    console.error('[admin/approvals] failed:', error)
    return NextResponse.json({ error: 'approvals_failed' }, { status: 500 })
  }
}
