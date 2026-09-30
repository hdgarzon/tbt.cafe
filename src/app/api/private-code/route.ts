import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase-admin'
import { hashCode } from '@/lib/private-code'
import { verifyTwoFactors } from '@/lib/two-factor'
import { notify } from '@/lib/notify'
import { PRIVATE_CODE_MIN as MIN_LEN, PRIVATE_CODE_MAX as MAX_LEN } from '@/lib/private-code-rules'

/**
 * El codigo privado — Work Order 02, Stage 10.1.
 *
 * Crear el primero basta con la sesion. Cambiarlo o quitarlo exige el codigo
 * actual y el biometrico: con una sesion robada no se reemplaza el unico factor
 * que un telefono robado y desbloqueado no aporta. Todo se escribe con el
 * service role y cada cambio se anuncia por security_change, que no se apaga.
 */

async function sessionUser(token: string) {
  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const {
    data: { user },
  } = await asUser.auth.getUser()
  return user
}

async function announce(admin: ReturnType<typeof createAdminClient>, userId: string, fact: string) {
  await notify(admin, {
    userId,
    eventKey: 'security_change',
    // El hecho es este codigo (o su retirada), no el momento.
    dedupeKey: `private_code:${fact}`,
    data: { variant: 'factor' },
    href: '/settings/authentication',
  })
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { code, frequency, currentCode, biometricProof } = await request.json()

    if (typeof code !== 'string' || code.length < MIN_LEN || code.length > MAX_LEN) {
      return NextResponse.json({ error: `El código debe tener entre ${MIN_LEN} y ${MAX_LEN} caracteres` }, { status: 400 })
    }
    if (frequency !== 'always' && frequency !== 'occasional') {
      return NextResponse.json({ error: 'Frecuencia inválida' }, { status: 400 })
    }

    const user = await sessionUser(token)
    if (!user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('private_code_hash').eq('id', user.id).single()

    // Ya hay un codigo: cambiarlo exige el actual y el biometrico.
    if (profile?.private_code_hash) {
      const gate = await verifyTwoFactors(token, { code: currentCode, biometricProof })
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })
    }

    const hash = await hashCode(code)
    const { error } = await admin
      .from('profiles')
      .update({ private_code_hash: hash, private_code_freq: frequency })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await announce(admin, user.id, hash.slice(-16))
    // Nunca devolver el código ni su hash
    return NextResponse.json({ ok: true, frequency })
  } catch {
    return NextResponse.json({ error: 'No pudimos guardar el código' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { currentCode, biometricProof } = (await request.json().catch(() => ({}))) as {
    currentCode?: string
    biometricProof?: string
  }
  // Quitarlo exige lo mismo que cambiarlo.
  const gate = await verifyTwoFactors(token, { code: currentCode, biometricProof })
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const { data: before } = await gate.admin.from('profiles').select('private_code_hash').eq('id', gate.userId).single()
  const { error } = await gate.admin
    .from('profiles')
    .update({ private_code_hash: null, private_code_freq: null })
    .eq('id', gate.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await announce(gate.admin, gate.userId, `removed:${String(before?.private_code_hash ?? '').slice(-16)}`)
  return NextResponse.json({ ok: true })
}
