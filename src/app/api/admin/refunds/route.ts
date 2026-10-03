import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, gateHighRisk, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { refundSale, refundServiceFee } from '@/lib/refunds'

/**
 * Reembolsos — Work Order 02, 8.2.
 *
 * Nunca automatico. Bajo `transactions.refund` y la regla de dos personas:
 * alguien lo pide con un motivo, otra persona lo aprueba, y quien lo pidio lo
 * aplica (APPLY en /admin).
 *
 *   kind: 'sale'         refundSale — el precio, las ganancias, la restitucion.
 *   kind: 'service_fee'  refundServiceFee — los $8 del comprador, con su ticket.
 *
 * La aprobacion se ata a lo que se aprobo. `gateHighRisk` comprueba la accion y
 * las personas, no el objeto; aqui, donde se mueve dinero, se comprueba antes
 * que la aprobacion sea para ESTA transferencia y este tipo de reembolso.
 */

type Kind = 'sale' | 'service_fee'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      transferId?: string
      kind?: Kind
      ticketRef?: string
      reason?: string
      approvalId?: string
    }
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const service = createAdminClient()

    const admin = await loadAdmin(service, auth.user.id)
    if (!admin || !can(admin, 'transactions.refund')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    const kind: Kind = body.kind === 'service_fee' ? 'service_fee' : 'sale'
    if (!body.transferId) return NextResponse.json({ error: 'transferId_required' }, { status: 400 })
    const reason = body.reason?.trim()
    if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })
    if (kind === 'service_fee' && !body.ticketRef) return NextResponse.json({ error: 'ticket_required' }, { status: 400 })

    const { data: transfer } = await service
      .from('transfers')
      .select('id, value_kind, payment_status, charge_path, sale_price, refund_state')
      .eq('id', body.transferId)
      .maybeSingle()
    if (!transfer || transfer.value_kind !== 'sale' || transfer.payment_status !== 'completed') {
      return NextResponse.json({ error: 'not_a_completed_sale' }, { status: 409 })
    }
    if (kind === 'sale' && transfer.refund_state === 'refunded') {
      return NextResponse.json({ error: 'already_refunded' }, { status: 409 })
    }

    const payload = { transferId: body.transferId, kind, ...(body.ticketRef ? { ticketRef: body.ticketRef } : {}) }

    if (body.approvalId) {
      const { data: approval } = await service
        .from('admin_pending_approvals')
        .select('entity_id, payload')
        .eq('id', body.approvalId)
        .maybeSingle()
      const approved = (approval?.payload ?? {}) as { transferId?: string; kind?: string; ticketRef?: string }
      if (
        !approval ||
        approval.entity_id !== body.transferId ||
        approved.transferId !== body.transferId ||
        approved.kind !== kind ||
        (approved.ticketRef ?? null) !== (body.ticketRef ?? null)
      ) {
        return NextResponse.json({ error: 'approval_mismatch' }, { status: 409 })
      }
    }

    const gate = await gateHighRisk(service, {
      actor: admin,
      action: 'transactions.refund',
      entityType: 'transfer',
      entityId: body.transferId,
      payload,
      reason,
      approvalId: body.approvalId,
    })
    if (!gate.proceed) {
      return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
    }

    const outcome =
      kind === 'sale'
        ? await refundSale(service, { transferId: body.transferId, reason })
        : await refundServiceFee(service, { transferId: body.transferId, ticketRef: body.ticketRef as string })

    await writeAudit(service, request, {
      actor: admin,
      approverId: gate.approverId,
      action: 'transactions.refund',
      entityType: 'transfer',
      entityId: body.transferId,
      before: { refund_state: transfer.refund_state, charge_path: transfer.charge_path, sale_price: transfer.sale_price },
      after: { kind, ...outcome },
      reason,
    })

    if (outcome.status === 'refunded') return NextResponse.json({ ok: true, ...outcome })
    return NextResponse.json(
      { error: outcome.reason, message: `Refund ${outcome.status}: ${outcome.reason}` },
      { status: outcome.status === 'refused' ? 409 : 502 }
    )
  } catch (error) {
    console.error('[admin/refunds] failed:', error)
    return NextResponse.json({ error: 'refund_failed' }, { status: 500 })
  }
}
