import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { verifyTwoFactors } from '@/lib/two-factor'
import { getRules } from '@/lib/rules'
import { notify } from '@/lib/notify'
import { sendSms } from '@/lib/sms'
import { dictFor } from '@/i18n/server'
import { APP_URL } from '@/lib/app-env'

/**
 * Cambiar el numero de telefono — Work Order 02, Stage 10.2 (47).
 *
 * Dos pasos. `begin`: codigo privado + biometrico, a lo sumo uno cada
 * `phone_change_days`, y entonces Supabase manda un codigo al numero nuevo.
 * `verify`: ese codigo confirma el cambio de ESE numero, dentro de 10 minutos.
 *
 * La alarma va al numero viejo y al e-Mail: una alarma, no una puerta. Las
 * transferencias pendientes dirigidas al numero viejo pasan al nuevo con un
 * enlace fresco; su ventana sigue contando desde la autorizacion original.
 * Sin factores, la pantalla lleva a una solicitud de ayuda. Sin tarifa.
 */

const PENDING_MS = 10 * 60 * 1000

function asUser(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

const e164 = (p: string) => `+${p.replace(/[^\d]/g, '')}`

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'begin' | 'verify'
    newPhone?: string
    code?: string
    biometricProof?: string
    otp?: string
  }
  if (!token) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  if (!body.newPhone || body.newPhone.replace(/[^\d]/g, '').length < 8) {
    return NextResponse.json({ error: 'phone_required' }, { status: 400 })
  }
  const newPhone = e164(body.newPhone)

  if (body.action === 'begin') {
    const gate = await verifyTwoFactors(token, { code: body.code, biometricProof: body.biometricProof })
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

    const { data: profile } = await gate.admin.from('profiles').select('phone_changed_at').eq('id', gate.userId).single()
    const { phoneChangeDays } = await getRules()
    if (profile?.phone_changed_at) {
      const next = new Date(new Date(profile.phone_changed_at).getTime() + phoneChangeDays * 86_400_000)
      if (next > new Date()) return NextResponse.json({ error: 'rate_limited', nextAt: next.toISOString() }, { status: 429 })
    }

    const { error } = await asUser(token).auth.updateUser({ phone: newPhone })
    if (error) return NextResponse.json({ error: 'otp_failed' }, { status: 400 })
    await gate.admin
      .from('profiles')
      .update({ phone_change_pending: newPhone, phone_change_pending_at: new Date().toISOString(), phone_change_pending_id: randomUUID() })
      .eq('id', gate.userId)
    return NextResponse.json({ sent: true })
  }

  if (body.action === 'verify') {
    const client = asUser(token)
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

    const { createAdminClient } = await import('@/lib/supabase-admin')
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('phone, email, language_override, phone_change_pending, phone_change_pending_at, phone_change_pending_id')
      .eq('id', user.id)
      .single()
    // Solo el numero que el primer paso autorizo, y solo un rato.
    const fresh = profile?.phone_change_pending_at && Date.now() - new Date(profile.phone_change_pending_at).getTime() < PENDING_MS
    if (!profile || profile.phone_change_pending !== newPhone || !fresh) {
      return NextResponse.json({ error: 'not_authorised' }, { status: 403 })
    }

    const { error } = await client.auth.verifyOtp({ phone: newPhone, token: String(body.otp ?? ''), type: 'phone_change' })
    if (error) return NextResponse.json({ error: 'invalid_otp' }, { status: 400 })

    const oldPhone = profile.phone as string | null
    const now = new Date().toISOString()
    await admin
      .from('profiles')
      .update({ phone: newPhone, phone_changed_at: now, phone_change_pending: null, phone_change_pending_at: null, phone_change_pending_id: null })
      .eq('id', user.id)

    const dict = dictFor(profile.language_override)
    // La alarma: al numero viejo, y al e-Mail por el aviso que no se apaga.
    if (oldPhone) await sendSms(oldPhone, `${dict.feed.events.security_change_phone} ${APP_URL}/help`, 'security_change_phone')
    await notify(admin, {
      userId: user.id,
      eventKey: 'security_change',
      dedupeKey: `phone_change:${profile.phone_change_pending_id}`,
      data: { variant: 'phone' },
      href: '/settings/authentication',
    })

    // Las transferencias pendientes siguen a quien las recibe; la ventana no se reinicia.
    if (oldPhone) {
      const { data: pending } = await admin
        .from('transfers')
        .select('id, work:works(title)')
        .eq('new_owner_phone', oldPhone)
        .eq('is_two_phase', true)
        .eq('payment_status', 'pending')
        .is('outcome', null)
      for (const t of (pending ?? []) as { id: string; work: { title: string | null } | { title: string | null }[] | null }[]) {
        await admin.from('transfers').update({ new_owner_phone: newPhone }).eq('id', t.id)
        const work = Array.isArray(t.work) ? t.work[0] : t.work
        const readdressed = dict.feed.events.transfers_readdressed ?? ''
        await sendSms(newPhone, `${readdressed.replace('{title}', work?.title ?? '')} ${APP_URL}/transfer/accept/${t.id}`, 'transfer_readdressed')
      }
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
