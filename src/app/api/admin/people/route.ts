/**
 * People — Backend Spec 07 §2.2.
 *
 * La sección donde vive el soporte: encontrar a una persona, entender su
 * situación y resolverla, en una sola pantalla.
 *
 * Los campos sensibles van ENMASCARADOS por defecto, y revelarlos queda en la
 * bitácora. Para responder casi cualquier pregunta no hace falta ver un teléfono
 * completo; que ver de más cueste un registro cambia el hábito por defecto sin
 * impedir el trabajo legítimo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'


/** Deja los últimos cuatro caracteres: bastan para confirmar sin exponer. */
function maskTail(value: string | null, keep = 4): string | null {
  if (!value) return null
  const v = String(value)
  if (v.length <= keep) return '•'.repeat(v.length)
  return '•'.repeat(Math.max(0, v.length - keep)) + v.slice(-keep)
}

function maskEmail(value: string | null): string | null {
  if (!value) return null
  const [user, domain] = value.split('@')
  if (!domain) return maskTail(value)
  const head = user.slice(0, 1)
  return `${head}${'•'.repeat(Math.max(1, user.length - 1))}@${domain}`
}

export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'people.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const q = (url.searchParams.get('q') ?? '').trim()

  // La autorización ya se comprobó arriba. Las políticas de estas tablas están
    // escritas para el cliente final —sus propios tickets, sus propias obras— y
    // aplicadas al equipo le esconderían justo lo que tiene que ver.
    const supabase = createAdminClient()

  // --- Búsqueda -------------------------------------------------------------
  if (!id) {
    if (!q) return NextResponse.json({ people: [] })

    // Por TBT-ID: se busca la obra y se devuelve a su creador. Soporte suele
    // llegar con un identificador de obra, no con un nombre.
    if (/^TBT-/i.test(q)) {
      const { data: work } = await supabase
        .from('works')
        .select('creator_id, tbt_id, title')
        .ilike('tbt_id', q)
        .single()
      if (!work) return NextResponse.json({ people: [] })
      const { data } = await supabase
        .from('profiles')
        .select('id, public_alias, display_name, legal_name, email, phone, is_creator, created_at')
        .eq('id', work.creator_id)
        .single()
      return NextResponse.json({
        people: data ? [shape(data)] : [],
        matchedVia: { tbtId: work.tbt_id, title: work.title },
      })
    }

    const like = `%${q}%`
    const { data, error } = await supabase
      .from('profiles')
      .select('id, public_alias, display_name, legal_name, email, phone, is_creator, created_at')
      .or(
        [
          `public_alias.ilike.${like}`,
          `display_name.ilike.${like}`,
          `legal_name.ilike.${like}`,
          `email.ilike.${like}`,
          `phone.ilike.${like}`,
          `collector_alias.ilike.${like}`,
        ].join(',')
      )
      .limit(25)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ people: (data ?? []).map(shape) })
  }

  // --- Ficha completa -------------------------------------------------------
  const [profile, works, tickets, credentials, offers, transfers] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).single(),
    supabase
      .from('works')
      .select('tbt_id, title, status, current_owner_id, created_at')
      .eq('creator_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('tickets')
      .select('ref, category, severity, status, subject, created_at')
      .eq('subject_user', id)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('webauthn_credentials')
      .select('device_label, bio_mode, created_at, last_used_at')
      .eq('user_id', id),
    supabase
      .from('offers')
      .select('amount, status, created_at')
      .eq('from_user', id)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('transfers')
      .select('outcome, payment_status, sale_price, initiated_at')
      .eq('from_owner_id', id)
      .order('initiated_at', { ascending: false })
      .limit(25),
  ])

  const p = profile.data
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const workRows = works.data ?? []

  return NextResponse.json({
    person: {
      id: p.id,
      identity: {
        alias: p.public_alias ?? p.collector_alias ?? null,
        displayName: p.display_name ?? p.legal_name ?? null,
        creatorType: p.creator_type ?? null,
        category: p.creator_category ?? p.collector_category ?? null,
        isCreator: p.is_creator,
        language: p.language_override ?? null,
        // Enmascarados. La versión completa se pide aparte y deja rastro.
        phoneMasked: maskTail(p.phone),
        emailMasked: maskEmail(p.email),
        hasPhone: !!p.phone,
        hasEmail: !!p.email,
        createdAt: p.created_at,
      },
      authentication: {
        privateCodeSet: !!p.private_code_hash,
        privateCodeFrequency: p.private_code_freq ?? null,
        recoveryEmailMasked: maskEmail(p.recovery_email),
        recoveryEmailVerified: !!p.recovery_email_verified,
        devices: (credentials.data ?? []).map((c) => ({
          label: c.device_label,
          mode: c.bio_mode,
          enrolledAt: c.created_at,
          lastUsedAt: c.last_used_at,
        })),
      },
      works: {
        created: workRows.length,
        stillHeld: workRows.filter((w) => w.current_owner_id === id).length,
        transferredAway: workRows.filter((w) => w.current_owner_id !== id).length,
        recent: workRows.slice(0, 10),
      },
      transactions: {
        offersMade: offers.data ?? [],
        transfersSent: transfers.data ?? [],
      },
      tickets: tickets.data ?? [],
      coveredRegistrationsGranted: p.covered_registrations_granted ?? 0,
      // Se dice que no existen en vez de pintar secciones vacías que parezcan
      // "sin actividad" (Spec 07 §2.2 y §4.3 del Área 6).
      notBuiltYet: ['payouts', 'flags'],
    },
  })
}

function shape(p: Record<string, unknown>) {
  return {
    id: p.id as string,
    alias: (p.public_alias ?? p.display_name ?? p.legal_name ?? null) as string | null,
    emailMasked: maskEmail((p.email ?? null) as string | null),
    phoneMasked: maskTail((p.phone ?? null) as string | null),
    isCreator: p.is_creator as boolean,
    createdAt: p.created_at as string,
  }
}

/**
 * Revelar un campo enmascarado.
 *
 * Es una acción, no una lectura: devuelve el valor completo y escribe en la
 * bitácora quién lo miró, de quién y cuándo.
 */
export async function POST(request: NextRequest) {

  try {
    const { personId, field, reason } = (await request.json()) as {
      personId?: string
      field?: 'phone' | 'email' | 'recovery_email'
      reason?: string
    }
    if (!personId || !field) return NextResponse.json({ error: 'personId and field required' }, { status: 400 })

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

    const admin = await loadAdmin(auth.supabase, auth.user.id)
    if (!can(admin, 'people.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    const column = field === 'recovery_email' ? 'recovery_email' : field
    // Por servicio: la política de `profiles` deja leer la fila propia, y esto
    // es precisamente leer la de otra persona — autorizado ya por people.view.
    const { data, error } = await createAdminClient()
      .from('profiles')
      .select(column)
      .eq('id', personId)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // El valor NO se guarda en la bitácora: se registra que se miró, no lo que
    // se vio. Copiar el dato al log lo duplicaría en un sitio más.
    await writeAudit(auth.supabase, request, {
      actor: admin!,
      action: 'people.reveal',
      entityType: 'profile',
      entityId: personId,
      after: { field },
      reason,
    })

    return NextResponse.json({ value: (data as Record<string, string | null>)[column] ?? null })
  } catch (error) {
    console.error('[admin/people] failed:', error)
    return NextResponse.json({ error: 'people_failed' }, { status: 500 })
  }
}
