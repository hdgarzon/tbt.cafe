import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { verifyCode } from '@/lib/private-code'

/**
 * Biométrico + código privado — Backend Spec 01 §5.1.
 *
 * Las dos acciones de payout que el spec marca como incondicionales —cobrar y
 * cambiar el destino— exigen los dos factores sin umbral. Esto vive en un lib
 * y no en cada ruta porque duplicar una comprobación de seguridad es cómo se
 * acaba arreglando solo una de las copias.
 *
 * El biométrico se comprueba consumiendo una prueba de un solo uso emitida por
 * la ruta que sí verifica la aserción WebAuthn. Un `biometric: true` del
 * cliente no es una comprobación: quien haga un POST directo lo afirma solo.
 *
 * El código privado tiene 3-5 caracteres y la propia app lo llama capa de
 * conveniencia, no un segundo factor real. Por eso los intentos se cuentan y
 * se bloquean: sin freno son diez mil combinaciones delante del dinero.
 */

export type TwoFactorFailure = {
  ok: false
  status: number
  body: { error: string; lockedUntil?: string | null }
}

export type TwoFactorSuccess = {
  ok: true
  userId: string
  /** Cliente con service role, ya construido, para lo que siga. */
  admin: SupabaseClient
}

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function verifyTwoFactors(
  token: string | undefined,
  input: { code?: string; biometricProof?: string }
): Promise<TwoFactorSuccess | TwoFactorFailure> {
  if (!token) {
    return { ok: false, status: 401, body: { error: 'not_authenticated' } }
  }
  if (typeof input.code !== 'string' || !input.code) {
    return { ok: false, status: 400, body: { error: 'code_required' } }
  }

  const asUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
  const {
    data: { user },
  } = await asUser.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, body: { error: 'not_authenticated' } }
  }

  const admin = serviceClient()

  const { data: attempts } = await admin
    .from('private_code_attempts')
    .select('locked_until')
    .eq('user_id', user.id)
    .single()

  if (attempts?.locked_until && new Date(attempts.locked_until) > new Date()) {
    return {
      ok: false,
      status: 429,
      body: { error: 'locked', lockedUntil: attempts.locked_until },
    }
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('private_code_hash')
    .eq('id', user.id)
    .single()

  // Se responde igual tanto si no hay código puesto como si está mal, para no
  // confirmar cuál de las dos cosas ocurre.
  const codeOk = profile?.private_code_hash
    ? await verifyCode(input.code, profile.private_code_hash)
    : false

  if (!codeOk) {
    const { data: lockedUntil } = await admin.rpc('private_code_register_failure', {
      who: user.id,
    })
    return {
      ok: false,
      status: 401,
      body: { error: 'invalid_code', lockedUntil: lockedUntil ?? null },
    }
  }

  await admin.rpc('private_code_clear_failures', { who: user.id })

  if (!input.biometricProof) {
    return { ok: false, status: 428, body: { error: 'biometric_required' } }
  }

  // Atómico y de un solo uso: dos peticiones simultáneas no pueden gastar la
  // misma prueba.
  const { data: proofOk } = await admin.rpc('consume_biometric_proof', {
    who: user.id,
    hash: createHash('sha256').update(input.biometricProof).digest('hex'),
  })
  if (proofOk !== true) {
    return { ok: false, status: 428, body: { error: 'biometric_required' } }
  }

  return { ok: true, userId: user.id, admin }
}
