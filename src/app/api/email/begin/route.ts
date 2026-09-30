import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { recordProviderEvent } from '@/lib/provider-events'
import { renderEmail, type Locale } from '@/lib/email-templates'
import { CODE_MAX_PER_HOUR, codeEmail, hashCode, newCode } from '@/lib/email-code'

/**
 * POST /api/email/begin — envía un código a la dirección que la persona escribió.
 *
 * Work Order 01 Step 19: la dirección se pide una vez y se verifica con un
 * código. Nada cambia en el perfil hasta que el código vuelve correcto: una
 * dirección escrita mal no queda guardada como si fuera suya.
 *
 * Se limita a unas pocas solicitudes por hora por persona: cada una manda un
 * correo a una dirección que el que pide elige.
 */
export const dynamic = 'force-dynamic'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 254) return NextResponse.json({ error: 'invalid_email' }, { status: 400 })

  const admin = createAdminClient()
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await admin
    .from('email_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
    .gte('created_at', since)
  if ((count ?? 0) >= CODE_MAX_PER_HOUR) return NextResponse.json({ error: 'too_many' }, { status: 429 })

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    await recordProviderEvent({ provider: 'resend', operation: 'send_email_code', ok: false, error: { code: 'not_configured' }, entityType: 'user', entityId: auth.user.id })
    return NextResponse.json({ error: 'email_unavailable' }, { status: 503 })
  }

  // La fila primero, para que el hash quede atado a esta solicitud.
  const code = newCode()
  const { data: row, error: insertError } = await admin
    .from('email_verifications')
    .insert({ user_id: auth.user.id, email, code_hash: 'pending' })
    .select('id')
    .single()
  if (insertError || !row) return NextResponse.json({ error: 'begin_failed' }, { status: 500 })
  await admin.from('email_verifications').update({ code_hash: hashCode(code, auth.user.id, row.id) }).eq('id', row.id)

  const { data: profile } = await admin.from('profiles').select('language_override').eq('id', auth.user.id).single()
  const locale = LOCALES.find((l) => l === profile?.language_override) ?? 'en'
  const copy = codeEmail(locale, code)

  // Resend devuelve { data, error }: el error se lee, no se supone.
  const { error: sendError } = await new Resend(apiKey).emails.send({
    from,
    to: email,
    subject: copy.subject,
    html: renderEmail(copy, null),
    text: `${copy.heading}\n\n${copy.body}`,
  })
  await recordProviderEvent({ provider: 'resend', operation: 'send_email_code', ok: !sendError, error: sendError ?? undefined, entityType: 'user', entityId: auth.user.id })
  if (sendError) {
    await admin.from('email_verifications').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
    return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  }

  return NextResponse.json({ sent: true })
}
