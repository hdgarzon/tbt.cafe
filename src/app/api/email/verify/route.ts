import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { CODE_MAX_ATTEMPTS, hashCode } from '@/lib/email-code'

/**
 * POST /api/email/verify — comprueba el código y, si es el bueno, guarda el e-Mail.
 *
 * Work Order 01 Step 19. Solo cuenta la solicitud más reciente de la persona:
 * pedir un código nuevo deja sin valor el anterior. Cada intento fallido se
 * cuenta; al quinto, la solicitud muere y hay que pedir otro código.
 *
 * El e-Mail se escribe con el service role: sus columnas son privadas (053) y
 * `recovery_email_verified` solo lo pone en true un código correcto, nunca el
 * navegador.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as { code?: unknown }
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
  if (code.length !== 6) return NextResponse.json({ error: 'invalid_code' }, { status: 400 })

  const admin = createAdminClient()
  const { data: req } = await admin
    .from('email_verifications')
    .select('id, email, code_hash, attempts, expires_at, consumed_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!req || req.consumed_at) return NextResponse.json({ error: 'no_pending_code' }, { status: 410 })
  if (new Date(req.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: 'expired' }, { status: 410 })
  if (req.attempts >= CODE_MAX_ATTEMPTS) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })

  if (hashCode(code, auth.user.id, req.id) !== req.code_hash) {
    const attempts = req.attempts + 1
    await admin
      .from('email_verifications')
      .update({ attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { consumed_at: new Date().toISOString() } : {}) })
      .eq('id', req.id)
    return NextResponse.json({ error: attempts >= CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code' }, { status: 400 })
  }

  const now = new Date().toISOString()
  // Se gasta primero: un código correcto sirve una sola vez aunque lleguen dos a la vez.
  const { data: spent } = await admin
    .from('email_verifications')
    .update({ consumed_at: now })
    .eq('id', req.id)
    .is('consumed_at', null)
    .select('id')
  if (!spent?.length) return NextResponse.json({ error: 'no_pending_code' }, { status: 410 })

  const { error } = await admin
    .from('profiles')
    .update({ recovery_email: req.email, recovery_email_verified: true })
    .eq('id', auth.user.id)
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  return NextResponse.json({ verified: true, email: req.email })
}
