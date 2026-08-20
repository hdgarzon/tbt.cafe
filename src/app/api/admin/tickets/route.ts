/**
 * Cola de tickets del equipo — Backend Spec 07 §2.6 y Spec 03 §9.
 *
 * Lo financiero primero por defecto: un cobro fallido de $40.000 y una duda
 * sobre regalías pueden estar los dos abiertos, y no son lo mismo.
 *
 * Ninguna acción de aquí es de alto riesgo, así que no pasan por la regla de
 * dos personas — pero todas quedan en la bitácora igual.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { notify } from '@/lib/notify'


export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'tickets.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // El acceso de administración exige biométrico + código privado (§1.4), no
  // solo pertenecer al equipo.
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const severity = url.searchParams.get('severity')
  const category = url.searchParams.get('category')
  const origin = url.searchParams.get('origin')

  let query = createAdminClient()
    .from('tickets')
    .select('id, ref, origin, category, severity, status, subject, body, context, subject_user, assigned_to, created_at, updated_at, replies:ticket_replies(id, author_type, author_name, body, internal, created_at)')
    // 'financial' ordena antes que 'secondary' alfabéticamente, que es
    // justamente el orden que pide el spec.
    .order('severity', { ascending: true })
    .order('updated_at', { ascending: false })
    .limit(100)

  if (status) query = query.eq('status', status)
  if (severity) query = query.eq('severity', severity)
  if (category) query = query.eq('category', category)
  if (origin) query = query.eq('origin', origin)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tickets: data ?? [] })
}

export async function POST(request: NextRequest) {

  try {
    const body = (await request.json()) as {
      action: 'reply' | 'assign' | 'status' | 'create'
      ticketId?: string
      text?: string
      internal?: boolean
      assignTo?: string | null
      status?: 'open' | 'answered' | 'resolved' | 'closed'
      subjectUser?: string
      subject?: string
      category?: string
      severity?: 'financial' | 'secondary'
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

    switch (body.action) {
      case 'reply': {
        if (!can(admin, 'tickets.reply')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        if (!body.ticketId || !body.text?.trim()) return NextResponse.json({ error: 'ticketId and text required' }, { status: 400 })

        const internal = body.internal === true
        const { error } = await supabase.from('ticket_replies').insert({
          ticket_id: body.ticketId,
          author_type: 'team',
          author_name: admin.displayName,
          body: body.text.trim(),
          internal,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        // Una nota interna no le habla al cliente, así que no mueve el ticket a
        // 'answered' — si lo hiciera, el equipo creería haber respondido — ni
        // le avisa a nadie.
        if (!internal) {
          const { data: tk } = await supabase
            .from('tickets')
            .update({ status: 'answered', updated_at: new Date().toISOString() })
            .eq('id', body.ticketId)
            .select('subject_user, ref, subject')
            .single()

          if (tk) {
            await notify(supabase, {
              userId: tk.subject_user,
              eventKey: 'ticket_reply',
              data: { ref: tk.ref, subject: tk.subject },
              href: '/help',
            })
          }
        }

        await writeAudit(supabase, request, {
          actor: admin,
          action: internal ? 'ticket.note' : 'ticket.reply',
          entityType: 'ticket',
          entityId: body.ticketId,
          after: { internal },
        })
        return NextResponse.json({ ok: true })
      }

      case 'assign': {
        if (!can(admin, 'tickets.assign')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        if (!body.ticketId) return NextResponse.json({ error: 'ticketId required' }, { status: 400 })

        const { data: before } = await supabase
          .from('tickets')
          .select('assigned_to')
          .eq('id', body.ticketId)
          .single()

        const { error } = await supabase
          .from('tickets')
          .update({ assigned_to: body.assignTo ?? null, updated_at: new Date().toISOString() })
          .eq('id', body.ticketId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        await writeAudit(supabase, request, {
          actor: admin,
          action: 'ticket.assign',
          entityType: 'ticket',
          entityId: body.ticketId,
          before,
          after: { assigned_to: body.assignTo ?? null },
        })
        return NextResponse.json({ ok: true })
      }

      case 'status': {
        if (!can(admin, 'tickets.close')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        if (!body.ticketId || !body.status) return NextResponse.json({ error: 'ticketId and status required' }, { status: 400 })

        // 'resolved' significa que el problema está arreglado Y el cliente lo
        // confirmó (Spec 03 §5). El equipo puede cerrar, pero no puede declarar
        // por el cliente que su problema quedó resuelto.
        if (body.status === 'resolved') {
          return NextResponse.json(
            { error: 'resolved_is_customer_confirmed', message: 'Only the customer confirms resolution. Close it instead if it is finished.' },
            { status: 409 }
          )
        }

        const { data: before } = await supabase
          .from('tickets')
          .select('status')
          .eq('id', body.ticketId)
          .single()

        const { error } = await supabase
          .from('tickets')
          .update({ status: body.status, updated_at: new Date().toISOString() })
          .eq('id', body.ticketId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        await writeAudit(supabase, request, {
          actor: admin,
          action: 'ticket.status',
          entityType: 'ticket',
          entityId: body.ticketId,
          before,
          after: { status: body.status },
        })
        return NextResponse.json({ ok: true })
      }

      case 'create': {
        // Para lo que llega por teléfono o en persona (Spec 03 §9).
        if (!can(admin, 'tickets.create')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        if (!body.subjectUser || !body.subject?.trim() || !body.text?.trim()) {
          return NextResponse.json({ error: 'subjectUser, subject and text required' }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('tickets')
          .insert({
            origin: 'human',
            category: body.category ?? 'other',
            severity: body.severity ?? 'secondary',
            subject: body.subject.trim(),
            body: body.text.trim(),
            subject_user: body.subjectUser,
            context: { surface: 'admin', opened_by_team: true },
          })
          .select('id, ref')
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        await writeAudit(supabase, request, {
          actor: admin,
          action: 'ticket.create',
          entityType: 'ticket',
          entityId: data.id,
          after: { ref: data.ref, subject_user: body.subjectUser },
        })
        return NextResponse.json({ ok: true, ref: data.ref })
      }

      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[admin/tickets] failed:', error)
    return NextResponse.json({ error: 'admin_tickets_failed' }, { status: 500 })
  }
}
