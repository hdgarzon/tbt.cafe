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
import { getRules, forgetRules } from '@/lib/rules'
import { RULE_AUTHORITY } from '@/lib/rules-shape'

/**
 * El valor que una columna acepta, por su forma. Los rangos los hace cumplir la
 * base (058): aqui solo se rechaza lo que ni siquiera tiene el tipo correcto.
 */
function ruleValue(column: string, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (column.endsWith('_message')) {
    const m = value as Record<string, unknown> | null
    const keys = ['en', 'es', 'pt', 'fr']
    return m && typeof m === 'object' && keys.every((k) => typeof m[k] === 'string' && (m[k] as string).trim())
      ? { ok: true, value: Object.fromEntries(keys.map((k) => [k, (m[k] as string).trim()])) }
      : { ok: false }
  }
  if (column.startsWith('pause_') || ['usdc_enabled', 'three_ds_registration_exempt', 'covered_brews_enabled'].indexOf(column) !== -1) {
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false }
  }
  if (column === 'scan_processor_url') {
    return typeof value === 'string' && /^https:\/\//.test(value.trim()) ? { ok: true, value: value.trim().replace(/\/+$/, '') } : { ok: false }
  }
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
}


export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'config.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  const [{ data: config }, { data: ledger, count }, rules] = await Promise.all([
    createAdminClient()
      .from('platform_config')
      .select('*')
      .single(),
    createAdminClient()
      .from('covered_registrations')
      .select('amount, reason, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(50),
    // Todas las reglas, la direccion del escaner incluida: quien ve esto tiene
    // config.view y paso el step-up (Work Order 02, 1.5).
    getRules(),
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
    rules,
    // Quien puede cambiar cada columna: la pantalla (§16) la muestra y la ruta
    // la hace cumplir.
    authority: RULE_AUTHORITY,
  })
}

export async function POST(request: NextRequest) {

  try {
    const body = (await request.json()) as {
      action: 'covered_count' | 'covered_kill_switch' | 'grant' | 'rule'
      value?: unknown
      /** Con `rule`: la columna de platform_config que se cambia. */
      column?: string
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

    // Una regla de §3 — Work Order 02, 1.5. Dos personas cuando cambia lo que
    // alguien paga; una persona, auditada, cuando es operacion.
    if (body.action === 'rule') {
      if (!can(admin, 'config.business_rules')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const column = String(body.column ?? '')
      if (!(column in RULE_AUTHORITY)) return NextResponse.json({ error: 'unknown_rule' }, { status: 400 })
      if (!body.reason?.trim()) return NextResponse.json({ error: 'reason_required' }, { status: 400 })
      const parsed = ruleValue(column, body.value)
      if (!parsed.ok) return NextResponse.json({ error: 'invalid_value' }, { status: 400 })

      let approverId: string | null = null
      if (RULE_AUTHORITY[column] === 'two_person') {
        const gate = await gateHighRisk(supabase, {
          actor: admin,
          action: 'config.business_rules',
          entityType: 'platform_config',
          entityId: column,
          payload: { action: 'rule', column, value: parsed.value },
          reason: body.reason.trim(),
          approvalId: body.approvalId,
        })
        if (!gate.proceed) {
          return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
        }
        approverId = gate.approverId
      }

      const { data: before } = await supabase.from('platform_config').select(column).single()
      const { error } = await supabase
        .from('platform_config')
        .update({ [column]: parsed.value, updated_at: new Date().toISOString() })
        .eq('id', true)
      // Un valor fuera de rango lo rechaza la base (058); se devuelve su motivo.
      if (error) return NextResponse.json({ error: 'rule_rejected', detail: error.message }, { status: 400 })
      forgetRules()

      await writeAudit(supabase, request, {
        actor: admin,
        approverId,
        action: `config.rule.${column}`,
        entityType: 'platform_config',
        entityId: column,
        before,
        after: { [column]: parsed.value },
        reason: body.reason.trim(),
      })
      return NextResponse.json({ ok: true, applied: { [column]: parsed.value } })
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
