import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { requireUser, storeChallenge, rpFromRequest, RP_NAME } from '@/lib/webauthn'

/**
 * POST /api/webauthn/register/begin — companion doc §5.1 (SEAM 1).
 * Emite el reto de registro. Requiere sesión (el OTP telefónico ya pasó).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request)
  if ('error' in auth) return auth.error
  const { supabase, userId, userName } = auth

  const rp = rpFromRequest(request)
  if (!rp) return NextResponse.json({ error: 'Origin faltante' }, { status: 400 })

  // Excluir credenciales ya registradas en este dispositivo
  const { data: existing } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', userId)

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // Touch ID / Face ID / Windows Hello
      userVerification: 'required',
      residentKey: 'preferred',
    },
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports ?? undefined) as never,
    })),
  })

  const { error } = await storeChallenge(supabase, userId, options.challenge, 'registration')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(options)
}
