import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { createAdminClient } from '@/lib/supabase-admin'
import { rpFromRequest } from '@/lib/webauthn'

/**
 * POST /api/webauthn/auth/finish — companion doc §5.3 + §6 (sign_count).
 *
 * Verifica la aserción WebAuthn y, si es válida, ACUÑA una sesión real de
 * Supabase — sin esto el biométrico no podría "iniciar sesión" de verdad.
 *
 * Supabase-js no expone un createSession() directo. El camino soportado:
 *   1. admin.generateLink({ type: 'magiclink' }) genera un magic link (y de
 *      paso trae la propiedades del link, incluido hashed_token).
 *   2. Ese hashed_token se canjea server-side con verifyOtp({ token_hash,
 *      type: 'magiclink' }), que SÍ devuelve una sesión (access_token +
 *      refresh_token).
 *   3. Esos tokens viajan al cliente, que los adopta con
 *      supabase.auth.setSession(). El cliente nunca ve el magic link ni el
 *      hashed_token por separado — solo la sesión ya canjeada.
 *
 * Requiere que el proyecto tenga habilitado el provider de Email en Supabase
 * (aunque el usuario haya entrado siempre por teléfono): generateLink de tipo
 * magiclink lo exige. Ver nota de despliegue al final del archivo.
 */
export async function POST(request: NextRequest) {
  const rp = rpFromRequest(request)
  if (!rp) return NextResponse.json({ error: 'Origin faltante' }, { status: 400 })

  const { userId, credential } = await request.json()
  if (typeof userId !== 'string' || !credential) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Reto: recuperarlo y CONSUMIRLO (un solo uso) antes de verificar nada más
  const { data: challengeRow } = await admin
    .from('webauthn_challenges')
    .select('id, challenge, expires_at')
    .eq('user_id', userId)
    .eq('kind', 'authentication')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!challengeRow) {
    return NextResponse.json({ error: 'Reto vencido o ausente' }, { status: 400 })
  }
  await admin.from('webauthn_challenges').delete().eq('id', challengeRow.id)
  if (new Date(challengeRow.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Reto vencido' }, { status: 400 })
  }

  // Credencial guardada para este userId + credential.id
  const { data: stored } = await admin
    .from('webauthn_credentials')
    .select('id, credential_id, public_key, sign_count, transports')
    .eq('user_id', userId)
    .eq('credential_id', credential.id)
    .maybeSingle()

  if (!stored) {
    return NextResponse.json({ error: 'Credencial desconocida' }, { status: 400 })
  }

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
      { error: e instanceof Error ? e.message : 'Verificación fallida' },
      { status: 400 }
    )
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'No verificado' }, { status: 401 })
  }

  const newCounter = verification.authenticationInfo.newCounter

  /**
   * Alarma de clonación (companion doc §6): si el contador devuelto NO es
   * mayor al guardado (y ambos son distintos de cero), es un posible
   * autenticador clonado. Se rechaza y se marca el evento de seguridad —
   * alimenta la notificación "suspicious activity" (§15).
   */
  if (stored.sign_count !== 0 && newCounter !== 0 && newCounter <= stored.sign_count) {
    // Merge, nunca overwrite: prefs guarda las preferencias reales del usuario.
    const { data: existingPrefs } = await admin
      .from('notification_prefs')
      .select('prefs')
      .eq('user_id', userId)
      .maybeSingle()

    await admin.from('notification_prefs').upsert(
      {
        user_id: userId,
        prefs: {
          ...(existingPrefs?.prefs as object | undefined),
          _last_security_event: { type: 'sign_count_regression', at: new Date().toISOString() },
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    return NextResponse.json(
      { error: 'Firma inválida — posible dispositivo clonado' },
      { status: 401 }
    )
  }

  // Actualizar contador y last_used_at — importante para la seguridad del próximo login
  await admin
    .from('webauthn_credentials')
    .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
    .eq('id', stored.id)

  // Acuñar la sesión real
  const { data: userRow, error: userErr } = await admin.auth.admin.getUserById(userId)
  if (userErr || !userRow.user) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }

  const email = userRow.user.email
  if (!email) {
    return NextResponse.json(
      {
        error:
          'Este usuario no tiene email registrado; el sign-in biométrico requiere uno ' +
          '(ver nota de despliegue en auth/finish/route.ts).',
      },
      { status: 501 }
    )
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr || !linkData) {
    return NextResponse.json({ error: linkErr?.message ?? 'No se pudo emitir sesión' }, { status: 500 })
  }

  const tokenHash = linkData.properties?.hashed_token
  if (!tokenHash) {
    return NextResponse.json({ error: 'El link generado no trae hashed_token' }, { status: 500 })
  }

  const { data: sessionData, error: verifyErr } = await admin.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })
  if (verifyErr || !sessionData.session) {
    return NextResponse.json({ error: verifyErr?.message ?? 'No se pudo canjear la sesión' }, { status: 500 })
  }

  return NextResponse.json({
    verified: true,
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  })
}

/**
 * NOTA DE DESPLIEGUE:
 * generateLink(type: 'magiclink') exige que el usuario tenga un email en
 * auth.users y que el provider de Email esté habilitado en el proyecto
 * Supabase — aunque el login normal sea 100% por teléfono. Es el único punto
 * de fricción real de la Opción A. Alternativas si no se quiere depender de
 * email: (a) exigir email de recuperación verificado (§9) antes de ofrecer
 * "quick sign-in"; (b) mover a la Opción B (biométrico solo como capa extra
 * sobre el OTP, sin sign-in independiente).
 */
