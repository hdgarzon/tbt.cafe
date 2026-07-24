import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { rpFromRequest } from '@/lib/webauthn'

/**
 * POST /api/webauthn/auth/begin — companion doc §5.3, camino quick.
 *
 * A diferencia de register/begin, aquí el usuario TODAVÍA NO tiene sesión
 * (está intentando entrar), así que se usa el cliente admin para:
 *   1. Ubicar al usuario por teléfono (E.164) vía Admin API.
 *   2. Leer sus credenciales WebAuthn (bypass de RLS, necesario sin sesión).
 *   3. Guardar el reto ligado a ese userId.
 *
 * Nunca se revela si el teléfono existe o no en la respuesta de error: mismo
 * mensaje genérico en ambos casos, para no filtrar qué números están registrados.
 */
export async function POST(request: NextRequest) {
  const { phone } = await request.json()
  if (typeof phone !== 'string' || !phone) {
    return NextResponse.json({ error: 'Teléfono requerido' }, { status: 400 })
  }

  const rp = rpFromRequest(request)
  if (!rp) return NextResponse.json({ error: 'Origin faltante' }, { status: 400 })

  const admin = createAdminClient()
  const generic = () =>
    NextResponse.json({ error: 'No hay biométrico configurado para este número' }, { status: 404 })

  // Ubicar al usuario por teléfono. listUsers no filtra por phone server-side,
  // así que se pagina; en un proyecto de este tamaño es aceptable.
  const clean = phone.replace(/\D/g, '')
  let userId: string | null = null
  for (let page = 1; page <= 5 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) break
    const match = data.users.find((u) => (u.phone ?? '').replace(/\D/g, '') === clean)
    if (match) userId = match.id
    if (data.users.length < 200) break
  }
  if (!userId) return generic()

  const { data: creds } = await admin
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', userId)

  if (!creds || creds.length === 0) return generic()

  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports ?? undefined) as never,
    })),
  })

  // Reto ligado al usuario, TTL corto, un solo uso — mismo mecanismo que el registro
  await admin.from('webauthn_challenges').delete().eq('user_id', userId).eq('kind', 'authentication')
  const { error: insErr } = await admin
    .from('webauthn_challenges')
    .insert({ user_id: userId, challenge: options.challenge, kind: 'authentication' })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // userId viaja de vuelta (no es secreto: el cliente ya lo insinuó al dar el teléfono)
  return NextResponse.json({ options, userId })
}
