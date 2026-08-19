import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { createClient } from '@supabase/supabase-js'
import { rpFromRequest, storeChallenge } from '@/lib/webauthn'

/**
 * Reto biométrico para el step-up — Backend Spec 07 §1.4.
 *
 * Vive fuera de `/api/admin/` a propósito: lo único que exige es sesión, y la
 * prueba que acaba emitiendo no es de administración — la usan tanto la consola
 * como el cobro de pagos. Bajo aquel prefijo, ponerle una comprobación de
 * `admin_members` habría parecido lo correcto y habría roto el cobro en
 * silencio. El step-up de administración —el que sí es privilegiado— sigue en
 * `/api/admin/step-up`.
 *
 * Existe aparte de `/api/webauthn/auth/begin` porque son cosas distintas y
 * confundirlas ya costó un 500 en producción:
 *
 *   login    — NO hay sesión. Identifica por teléfono y termina emitiendo una.
 *   step-up  — SÍ hay sesión. La identidad ya se conoce; solo hay que probar
 *              presencia, y no debe emitirse ninguna sesión nueva.
 *
 * Aquí el usuario sale del token, así que no hace falta teléfono ni buscar a
 * nadie: se piden las credenciales de quien ya está autenticado.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const {
      data: { user },
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const rp = rpFromRequest(request)
    if (!rp) return NextResponse.json({ error: 'Origin missing' }, { status: 400 })

    const admin = createAdminClient()
    const { data: creds } = await admin
      .from('webauthn_credentials')
      .select('credential_id, transports')
      .eq('user_id', user.id)

    if (!creds || creds.length === 0) {
      // Se distingue de un fallo: no hay nada que verificar todavía, y la
      // pantalla puede decir qué hacer en vez de "falló".
      return NextResponse.json({ error: 'no_credentials' }, { status: 404 })
    }

    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: 'required',
      allowCredentials: creds.map((c) => ({
        id: c.credential_id as string,
        transports: (c.transports ?? undefined) as never,
      })),
    })

    await storeChallenge(admin, user.id, options.challenge, 'authentication')

    return NextResponse.json({ options })
  } catch (error) {
    console.error('[step-up/begin] failed:', error)
    return NextResponse.json({ error: 'step_up_begin_failed' }, { status: 500 })
  }
}
