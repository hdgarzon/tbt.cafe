import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Confirmar el nombre acreditado — Chains 01, Stage 1.3.
 *
 * El nombre bajo el que se acredita una obra va al registro permanente y no se
 * puede retirar. Se confirma una vez, antes del primer Sello: el que ya era o
 * un alias nuevo. Las siguientes registraciones lo usan sin preguntar.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { name } = (await request.json().catch(() => ({}))) as { name?: string }
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  if (clean.length < 2 || clean.length > 80) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('profiles')
    .update({ public_alias: clean, credited_name_confirmed_at: new Date().toISOString() })
    .eq('id', auth.user.id)
  if (error) return NextResponse.json({ error: 'confirm_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, name: clean })
}
