import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { requireUser, consumeChallenge, rpFromRequest, deviceLabel } from '@/lib/webauthn'

/**
 * POST /api/webauthn/register/finish — companion doc §5.2 (SEAM 2).
 * Verifica la attestation y guarda la clave pública. bioMode (quick | extra)
 * viene de la elección del usuario en la UI.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request)
  if ('error' in auth) return auth.error
  const { supabase, userId } = auth

  const rp = rpFromRequest(request)
  if (!rp) return NextResponse.json({ error: 'Origin faltante' }, { status: 400 })

  const body = await request.json()
  const { credential, bioMode } = body
  if (bioMode !== 'quick' && bioMode !== 'extra') {
    return NextResponse.json({ error: 'bioMode inválido' }, { status: 400 })
  }

  const expectedChallenge = await consumeChallenge(supabase, userId, 'registration')
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Reto vencido o ausente' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Verificación fallida' },
      { status: 400 }
    )
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'No verificado' }, { status: 400 })
  }

  // API v13: la credencial vive bajo registrationInfo.credential
  const { credential: cred } = verification.registrationInfo

  const { error } = await supabase.from('webauthn_credentials').insert({
    user_id: userId,
    credential_id: cred.id, // ya es base64url string
    public_key: isoBase64URL.fromBuffer(cred.publicKey), // Uint8Array → base64url text
    sign_count: cred.counter,
    transports: cred.transports ?? null,
    device_label: deviceLabel(request),
    bio_mode: bioMode,
  })

  if (error) {
    // 23505 = unique_violation → esta credencial ya estaba registrada
    const already = (error as { code?: string }).code === '23505'
    return NextResponse.json(
      { error: already ? 'Este dispositivo ya está registrado' : error.message },
      { status: already ? 409 : 500 }
    )
  }

  return NextResponse.json({ verified: true, device: deviceLabel(request), bioMode })
}
