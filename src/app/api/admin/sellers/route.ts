import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, gateHighRisk, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { notify } from '@/lib/notify'
import { pathFor, type SellerRow } from '@/lib/seller'

/**
 * Aprobar, rechazar, suspender y reintegrar vendedores — Work Order 02, 2.6.
 *
 * Hasta que exista la herramienta de administracion, por la regla de dos
 * personas que ya existe: alguien lo pide con un motivo, otra persona lo
 * aprueba, y quien lo pidio lo aplica (APPLY en /admin). `admin_pending_approvals`
 * guarda la accion como texto, asi que las cuatro caben sin cambiar el esquema.
 *
 * El permiso es `bizops.act`, el nombre del Atlas para lo que esta orden crea.
 */

const ACTIONS = ['seller.approve', 'seller.decline', 'seller.suspend', 'seller.reinstate'] as const
type SellerAction = (typeof ACTIONS)[number]

const SELLER_COLUMNS =
  'user_id, status, suspended_at, suspended_reason, country, charge_path, entity_type, declined_reason, remembered_listings'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'bizops.act')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  const { data } = await createAdminClient()
    .from('seller_accounts')
    .select(`${SELLER_COLUMNS}, applied_at, approved_at`)
    .in('status', ['pending', 'active', 'paused_self', 'declined'])
    .order('applied_at', { ascending: false, nullsFirst: false })
    .limit(200)
  return NextResponse.json({ sellers: data ?? [] })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: SellerAction
      userId?: string
      reason?: string
      approvalId?: string
    }
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const service = createAdminClient()

    const admin = await loadAdmin(service, auth.user.id)
    if (!admin || !can(admin, 'bizops.act')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    const action = body.action
    if (!action || ACTIONS.indexOf(action) === -1) return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
    if (!body.userId) return NextResponse.json({ error: 'userId_required' }, { status: 400 })
    // Cada accion lleva su motivo (2.6): quien lo lee despues es la persona.
    const reason = body.reason?.trim()
    if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })

    const { data: current } = await service.from('seller_accounts').select(SELLER_COLUMNS).eq('user_id', body.userId).maybeSingle()
    const seller = current as SellerRow | null
    if (!seller) return NextResponse.json({ error: 'seller_not_found' }, { status: 404 })

    // Cada accion solo tiene sentido desde ciertos estados. Se comprueba antes
    // de pedir la aprobacion y otra vez al aplicar.
    const valid =
      (action === 'seller.approve' && seller.status === 'pending') ||
      (action === 'seller.decline' && seller.status === 'pending') ||
      (action === 'seller.suspend' && !seller.suspended_at) ||
      (action === 'seller.reinstate' && !!seller.suspended_at)
    if (!valid) return NextResponse.json({ error: 'invalid_state', status: seller.status }, { status: 409 })

    const gate = await gateHighRisk(service, {
      actor: admin,
      action,
      entityType: 'seller',
      entityId: body.userId,
      payload: { userId: body.userId },
      reason,
      approvalId: body.approvalId,
    })
    if (!gate.proceed) {
      return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
    }

    const now = new Date().toISOString()
    let patch: Record<string, unknown> = {}
    let variant: 'approved' | 'declined' | 'suspended' | 'reinstated'

    if (action === 'seller.approve') {
      // La via sale de provider_countries y de nada mas (2.3).
      const { data: row } = await service.from('provider_countries').select('merchant').eq('country', seller.country ?? '').maybeSingle()
      if (!row) return NextResponse.json({ error: 'country_not_covered' }, { status: 409 })
      patch = { status: 'active', charge_path: pathFor(row), approved_at: now, approved_by: admin.userId, declined_reason: null }
      variant = 'approved'
    } else if (action === 'seller.decline') {
      patch = { status: 'declined', declined_reason: reason }
      variant = 'declined'
    } else if (action === 'seller.suspend') {
      // Los mismos efectos que pausarse, sin Reanudar (2.7): lo que estaba en
      // venta sale y se recuerda, para que reintegrar pueda ofrecerlo de vuelta.
      const { data: listed } = await service
        .from('work_commerce')
        .select('work_id, works!inner(current_owner_id)')
        .eq('availability', 'for_sale')
        .eq('works.current_owner_id', body.userId)
      const ids = (listed ?? []).map((r) => r.work_id as string)
      patch = {
        suspended_at: now,
        suspended_reason: reason,
        suspended_by: admin.userId,
        remembered_listings: Array.from(new Set([...(seller.remembered_listings ?? []), ...ids])),
      }
      if (ids.length) await service.from('work_commerce').update({ availability: 'not_for_sale' }).in('work_id', ids)
      variant = 'suspended'
    } else {
      patch = { suspended_at: null, suspended_reason: null, suspended_by: null }
      variant = 'reinstated'
    }

    const { error } = await service.from('seller_accounts').update({ ...patch, updated_at: now }).eq('user_id', body.userId)
    if (error) return NextResponse.json({ error: 'seller_update_failed' }, { status: 500 })

    await writeAudit(service, request, {
      actor: admin,
      approverId: gate.approverId,
      action,
      entityType: 'seller',
      entityId: body.userId,
      before: { status: seller.status, suspended_at: seller.suspended_at },
      after: patch,
      reason,
    })

    // El hecho que se avisa es esta aprobacion: su id no se repite.
    await notify(service, {
      userId: body.userId,
      eventKey: 'selling_status',
      dedupeKey: `${action}:${body.approvalId ?? now}`,
      data: { variant, reason },
      href: '/settings/selling',
    })

    return NextResponse.json({ ok: true, applied: patch })
  } catch (error) {
    console.error('[admin/sellers] failed:', error)
    return NextResponse.json({ error: 'seller_action_failed' }, { status: 500 })
  }
}
