import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { createAdminClient } from '@/lib/supabase-admin'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, createHash } from 'crypto'
import { rpFromRequest } from '@/lib/webauthn'

/**
 * Verifica la aserción del step-up y emite la prueba biométrica.
 *
 * A diferencia de `/api/webauthn/auth/finish`, esta ruta NO emite sesión: quien
 * llega ya la tiene, y lo único que hace falta es demostrar presencia ahora
 * mismo. Emitir una sesión aquí sería un efecto secundario que nadie pidió.
 *
 * Esta es la única ruta que puede afirmar que el biométrico ocurrió para un
 * step-up, así que es la única que emite la prueba (Spec 07 §1.4).
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { credential } = await request.json()
    if (!credential) return NextResponse.json({ error: 'credential required' }, { status: 400 })

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

    const { data: challengeRow } = await admin
      .from('webauthn_challenges')
      .select('challenge')
      .eq('user_id', user.id)
      .eq('kind', 'authentication')
      .maybeSingle()
    if (!challengeRow) return NextResponse.json({ error: 'No challenge' }, { status: 400 })

    const { data: stored } = await admin
      .from('webauthn_credentials')
      .select('id, credential_id, public_key, sign_count, transports')
      .eq('user_id', user.id)
      .eq('credential_id', credential.id)
      .maybeSingle()
    if (!stored) return NextResponse.json({ error: 'Unknown credential' }, { status: 400 })

    let verification
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential: {
          id: stored.credential_id,
          publicKey: isoBase64URL.toBuffer(stored.public_key as string),
          counter: stored.sign_count,
          transports: (stored.transports ?? undefined) as never,
        },
        requireUserVerification: true,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Verification failed' },
        { status: 400 }
      )
    }

    if (!verification.verified) {
      return NextResponse.json({ error: 'Not verified' }, { status: 401 })
    }

    // Contador y último uso, igual que el login: un contador que no avanza
    // delata un autenticador clonado.
    const newCounter = verification.authenticationInfo.newCounter
    if (newCounter !== 0 && stored.sign_count !== 0 && newCounter <= stored.sign_count) {
      return NextResponse.json({ error: 'counter_regression' }, { status: 401 })
    }
    await admin
      .from('webauthn_credentials')
      .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
      .eq('id', stored.id)

    await admin.from('webauthn_challenges').delete().eq('user_id', user.id).eq('kind', 'authentication')

    // La prueba: con hash, de un solo uso, dos minutos.
    const proof = randomBytes(32).toString('hex')
    await admin.from('biometric_proofs').insert({
      user_id: user.id,
      token_hash: createHash('sha256').update(proof).digest('hex'),
    })

    return NextResponse.json({ verified: true, biometricProof: proof })
  } catch (error) {
    console.error('[admin/step-up/verify] failed:', error)
    return NextResponse.json({ error: 'step_up_verify_failed' }, { status: 500 })
  }
}
