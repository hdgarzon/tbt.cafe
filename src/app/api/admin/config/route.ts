/**
 * Configuración — Backend Spec 07 §2.8.
 *
 * Aquí viven los controles del programa de registraciones cubiertas. Importan
 * porque la exposición agregada NO tiene tope: es por creador y no está acotado
 * en el tiempo, así que 5.000 creadores usando diez cada uno son $400.000
 * absorbidos. El interruptor existe para poder parar el programa sin desplegar,
 * y hasta ahora no había forma de accionarlo.
 *
 * Cambiar el cupo o accionar el interruptor es de alto riesgo y pasa por la
 * regla de dos personas. Regalar registraciones a una persona concreta no lo
 * es, pero queda en la bitácora igual.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, gateHighRisk, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'


export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'config.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  const [{ data: config }, { data: ledger, count }] = await Promise.all([
    createAdminClient()
      .from('platform_config')
      .select('covered_brews_enabled, covered_brews_count, updated_at')
      .single(),
    createAdminClient()
      .from('covered_registrations')
      .select('amount, reason, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  // Coste absorbido hasta la fecha: es gasto real y tiene que ser contable, no
  // un cobro ausente.
  const rows = ledger ?? []
  const totalBorne = rows.reduce((sum, r) => sum + Number(r.amount), 0)

  return NextResponse.json({
    config,
    covered: {
      count: count ?? 0,
      recent: rows,
      // Solo de las filas traídas; el total exacto sale del export.
      borneInRecent: totalBorne,
    },
    canChangeRules: can(admin, 'config.business_rules'),
  })
}

export async function POST(request: NextRequest) {

  try {
    const body = (await request.json()) as {
      action: 'covered_count' | 'covered_kill_switch' | 'grant'
      value?: number | boolean
      userId?: string
      reason?: string
      approvalId?: string
    }

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    // La autorización ya se comprobó arriba. Las políticas de estas tablas están
    // escritas para el cliente final —sus propios tickets, sus propias obras— y
    // aplicadas al equipo le esconderían justo lo que tiene que ver.
    const supabase = createAdminClient()

    const admin = await loadAdmin(supabase, auth.user.id)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    // Regalar registraciones a una persona: riesgo normal, pero auditado.
    if (body.action === 'grant') {
      if (!can(admin, 'config.knowledge') && !can(admin, 'config.business_rules')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (!body.userId || typeof body.value !== 'number') {
        return NextResponse.json({ error: 'userId and a numeric value are required' }, { status: 400 })
      }

      const { data: before } = await supabase
        .from('profiles')
        .select('covered_registrations_granted')
        .eq('id', body.userId)
        .single()

      const { error } = await supabase
        .from('profiles')
        .update({ covered_registrations_granted: body.value })
        .eq('id', body.userId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await writeAudit(supabase, request, {
        actor: admin,
        action: 'config.covered.grant',
        entityType: 'profile',
        entityId: body.userId,
        before,
        after: { covered_registrations_granted: body.value },
        reason: body.reason,
      })
      return NextResponse.json({ ok: true })
    }

    // Lo demás cambia las reglas para todo el mundo: dos personas.
    if (!can(admin, 'config.business_rules')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!body.reason?.trim()) {
      // La razón es obligatoria y de texto libre: el valor está en lo que
      // alguien elige escribir.
      return NextResponse.json({ error: 'reason_required' }, { status: 400 })
    }

    const gate = await gateHighRisk(supabase, {
      actor: admin,
      action: 'config.business_rules',
      entityType: 'platform_config',
      entityId: body.action,
      payload: { action: body.action, value: body.value },
      reason: body.reason.trim(),
      approvalId: body.approvalId,
    })

    if (!gate.proceed) {
      return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
    }

    const { data: before } = await supabase
      .from('platform_config')
      .select('covered_brews_enabled, covered_brews_count')
      .single()

    const patch =
      body.action === 'covered_count'
        ? { covered_brews_count: Number(body.value) }
        : { covered_brews_enabled: body.value === true }

    const { error } = await supabase
      .from('platform_config')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', true)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit(supabase, request, {
      actor: admin,
      approverId: gate.approverId,
      action: `config.${body.action}`,
      entityType: 'platform_config',
      entityId: 'platform_config',
      before,
      after: patch,
      reason: body.reason.trim(),
    })

    return NextResponse.json({ ok: true, applied: patch })
  } catch (error) {
    console.error('[admin/config] failed:', error)
    return NextResponse.json({ error: 'config_failed' }, { status: 500 })
  }
}
