import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, createHash } from 'crypto'
import { verifyCode } from '@/lib/private-code'

/**
 * Step-up de administración — Backend Spec 07 §1.4.
 *
 * El acceso de administración exige biométrico + código privado. Se emite aquí
 * y no en el backend de Forms porque el biométrico (WebAuthn) se verifica en
 * este repo; el token viaja por la base compartida y allá solo se valida.
 *
 * El código privado tiene 3-5 caracteres y la propia app lo llama capa de
 * conveniencia, no un segundo factor real. Por eso los intentos se cuentan y se
 * bloquean: sin freno, cuatro dígitos son diez mil combinaciones delante de la
 * superficie más privilegiada del producto.
 *
 * Se responde igual —"código incorrecto"— tanto si la persona no tiene código
 * puesto como si lo puso mal, para no confirmar cuál de las dos cosas ocurre.
 */

const TTL_MINUTES = 15

function userClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { code, biometric } = (await request.json()) as { code?: string; biometric?: boolean }
    if (typeof code !== 'string' || !code) {
      return NextResponse.json({ error: 'Code required' }, { status: 400 })
    }

    const {
      data: { user },
    } = await userClient(token).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const admin = serviceClient()

    // Solo el equipo. Alguien de fuera ni siquiera debe poder gastar intentos
    // contra esta puerta.
    const { data: member } = await admin
      .from('admin_members')
      .select('active')
      .eq('user_id', user.id)
      .single()
    if (!member?.active) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: attempts } = await admin
      .from('private_code_attempts')
      .select('locked_until')
      .eq('user_id', user.id)
      .single()

    if (attempts?.locked_until && new Date(attempts.locked_until) > new Date()) {
      return NextResponse.json(
        { error: 'locked', lockedUntil: attempts.locked_until },
        { status: 429 }
      )
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('private_code_hash')
      .eq('id', user.id)
      .single()

    const ok = profile?.private_code_hash ? await verifyCode(code, profile.private_code_hash) : false

    if (!ok) {
      const { data: lockedUntil } = await admin.rpc('private_code_register_failure', { who: user.id })
      return NextResponse.json(
        { error: 'invalid_code', lockedUntil: lockedUntil ?? null },
        { status: 401 }
      )
    }

    await admin.rpc('private_code_clear_failures', { who: user.id })

    // El spec pide los dos factores. Si el biométrico no se presentó se dice
    // claramente, en vez de emitir un step-up a medias que parezca completo.
    if (biometric !== true) {
      return NextResponse.json({ error: 'biometric_required' }, { status: 428 })
    }

    const raw = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(raw).digest('hex')
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString()

    const { error } = await admin.from('admin_step_up').insert({
      user_id: user.id,
      token_hash: tokenHash,
      used_biometric: true,
      used_private_code: true,
      expires_at: expiresAt,
    })
    if (error) return NextResponse.json({ error: 'step_up_failed' }, { status: 500 })

    // El token en claro solo existe en esta respuesta. En la base queda su hash.
    return NextResponse.json({ token: raw, expiresAt })
  } catch (error) {
    console.error('[admin/step-up] failed:', error)
    return NextResponse.json({ error: 'step_up_failed' }, { status: 500 })
  }
}
