import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, gateHighRisk, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { releaseExpiry } from '@/lib/velocity'

/**
 * Liberar o rechazar una retencion de pareja nueva — Work Order 02, 10.4.
 *
 * Hasta que exista la herramienta de administracion, por las aprobaciones.
 * Liberada, la persona puede seguir durante 48 horas; rechazada, con motivo.
 */
const ACTIONS = { 'velocity.release': 'released', 'velocity.decline': 'declined' } as const
type Action = keyof typeof ACTIONS

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: Action; holdId?: string; reason?: string; approvalId?: string }
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const service = createAdminClient()
    const admin = await loadAdmin(service, auth.user.id)
    if (!admin || !can(admin, 'bizops.act')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }
    if (!body.action || !(body.action in ACTIONS)) return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
    if (!body.holdId) return NextResponse.json({ error: 'holdId_required' }, { status: 400 })
    const reason = body.reason?.trim()
    if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })

    const { data: hold } = await service.from('velocity_holds').select('id, status, user_id').eq('id', body.holdId).maybeSingle()
    if (!hold) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (hold.status !== 'held') return NextResponse.json({ error: 'invalid_state', status: hold.status }, { status: 409 })

    const gate = await gateHighRisk(service, {
      actor: admin,
      action: body.action,
      entityType: 'velocity_hold',
      entityId: body.holdId,
      payload: { holdId: body.holdId },
      reason,
      approvalId: body.approvalId,
    })
    if (!gate.proceed) {
      return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
    }

    const status = ACTIONS[body.action]
    const patch =
      status === 'released'
        ? { status, released_at: new Date().toISOString(), release_expires_at: releaseExpiry(), reason }
        : { status, reason }
    await service.from('velocity_holds').update(patch).eq('id', body.holdId).eq('status', 'held')
    await writeAudit(service, request, {
      actor: admin,
      approverId: gate.approverId,
      action: body.action,
      entityType: 'velocity_hold',
      entityId: body.holdId,
      before: { status: 'held' },
      after: patch,
      reason,
    })
    return NextResponse.json({ ok: true, ...patch })
  } catch (error) {
    console.error('[admin/velocity-holds] failed:', error)
    return NextResponse.json({ error: 'velocity_failed' }, { status: 500 })
  }
}
