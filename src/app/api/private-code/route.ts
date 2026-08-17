import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashCode } from '@/lib/private-code'

/**
 * Código privado — Master Handoff §10.
 *
 * SEGURIDAD: solo se guarda el hash, nunca el texto en claro. Un código de 3-5
 * caracteres es de baja entropía: es una capa de conveniencia, NO un segundo
 * factor real. La frecuencia se aplica del lado del servidor y la vía de
 * recuperación es el email verificado.
 *
 * El hashing (scrypt) vive en src/lib/private-code.ts: un archivo de ruta solo
 * puede exportar handlers, no funciones auxiliares.
 *
 * No hace falta service-role: se usa el token del propio usuario, y la RLS de
 * `profiles` (escritura solo de la fila propia) garantiza que nadie toque la
 * fila de otro.
 */


import { PRIVATE_CODE_MIN as MIN_LEN, PRIVATE_CODE_MAX as MAX_LEN } from '@/lib/private-code-rules'

function clientFor(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { code, frequency } = await request.json()

    if (typeof code !== 'string' || code.length < MIN_LEN || code.length > MAX_LEN) {
      return NextResponse.json(
        { error: `El código debe tener entre ${MIN_LEN} y ${MAX_LEN} caracteres` },
        { status: 400 }
      )
    }
    if (frequency !== 'always' && frequency !== 'occasional') {
      return NextResponse.json({ error: 'Frecuencia inválida' }, { status: 400 })
    }

    const supabase = clientFor(token)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        private_code_hash: await hashCode(code),
        private_code_freq: frequency,
      })
      .eq('id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Nunca devolver el código ni su hash
    return NextResponse.json({ ok: true, frequency })
  } catch {
    return NextResponse.json({ error: 'No pudimos guardar el código' }, { status: 500 })
  }
}

/** Quita el código privado de la cuenta. */
export async function DELETE(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const supabase = clientFor(token)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const { error } = await supabase
    .from('profiles')
    .update({ private_code_hash: null, private_code_freq: null })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
