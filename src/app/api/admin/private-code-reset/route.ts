import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, gateHighRisk, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { notify } from '@/lib/notify'

/**
 * resetPrivateCode — Work Order 02, Stage 10.3 (D-2).
 *
 * Por la regla de dos personas, siempre con una solicitud de ayuda detras: se
 * borra el codigo, se anuncia por security_change, y la persona pone uno nuevo
 * en su proxima accion de dinero. La pantalla es de la herramienta de
 * administracion; hasta entonces, las aprobaciones de /admin.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { userId?: string; ticketRef?: string; reason?: string; approvalId?: string }
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const service = createAdminClient()
    const admin = await loadAdmin(service, auth.user.id)
    if (!admin || !can(admin, 'bizops.act')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }
    if (!body.userId) return NextResponse.json({ error: 'userId_required' }, { status: 400 })
    if (!body.ticketRef?.trim()) return NextResponse.json({ error: 'ticket_required' }, { status: 400 })
    const reason = body.reason?.trim()
    if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })

    const gate = await gateHighRisk(service, {
      actor: admin,
      action: 'private_code.reset',
      entityType: 'profile',
      entityId: body.userId,
      payload: { userId: body.userId, ticketRef: body.ticketRef.trim() },
      reason,
      approvalId: body.approvalId,
    })
    if (!gate.proceed) {
      return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
    }

    const { error } = await service
      .from('profiles')
      .update({ private_code_hash: null, private_code_freq: null })
      .eq('id', body.userId)
    if (error) return NextResponse.json({ error: 'reset_failed' }, { status: 500 })
    await service.from('private_code_attempts').delete().eq('user_id', body.userId)

    await writeAudit(service, request, {
      actor: admin,
      approverId: gate.approverId,
      action: 'private_code.reset',
      entityType: 'profile',
      entityId: body.userId,
      before: null,
      after: { private_code: 'cleared', ticket: body.ticketRef.trim() },
      reason,
    })
    await notify(service, {
      userId: body.userId,
      eventKey: 'security_change',
      dedupeKey: `private_code_reset:${body.approvalId ?? body.ticketRef.trim()}`,
      data: { variant: 'reset' },
      href: '/settings/authentication',
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin/private-code-reset] failed:', error)
    return NextResponse.json({ error: 'reset_failed' }, { status: 500 })
  }
}
