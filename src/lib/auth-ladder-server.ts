import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

/**
 * La escalera de autenticación, del lado que manda — Backend Spec 01 §5.1.
 *
 *   por debajo de $500   solo scoring de Radar, sin fricción añadida
 *   $500 y más           biométrico
 *   $1.000 y más         biométrico + 3D Secure
 *
 * Convive con `auth-ladder.ts`, y la diferencia es la razón de que sean dos
 * archivos: aquel decide qué PEDIR y corre en el cliente; este decide qué se
 * ACEPTA y no debe importarse nunca desde un componente. Los nombres tienen
 * que seguir distintos aunque digan lo mismo — una escalera que el cliente
 * resuelve por su cuenta no es una escalera. Sin esta comprobación, un POST directo a la ruta
 * de compra se salta el sensor entero y la escalera es decorado — que es
 * exactamente el fallo que ya dejó escrito la migración 018 de tbt-cafe:
 * una comprobación que el cliente puede afirmar por su cuenta no es una
 * comprobación.
 *
 * El MONTO no viene del cliente. Las dos rutas que llaman aquí ya lo leen de
 * la base —`work_commerce.initial_price` en la compra, el valor validado en la
 * transferencia— y se lo pasan. Aceptar un monto del cliente permitiría
 * declarar $1 para saltarse los dos escalones.
 *
 * FALLA CERRADO. Si la resolución no se puede hacer, se rechaza. Una ruta de
 * pago que deja de comprobar la autenticación porque le falta una tabla es la
 * peor versión posible de este archivo.
 *
 * PRERREQUISITO: migración 021_auth_ladder, ya aplicada. Sin ella no existen
 * `resolve_auth_ladder` ni `money_action_auth`, y estas rutas rechazarán todo.
 */

export type LadderAction = 'purchase' | 'offer_accept' | 'transfer_initiate'

export type LadderVerdict =
  | { ok: true; requireThreeDS: boolean }
  | { ok: false; status: number; error: string }

export async function enforceLadder(params: {
  /** Cliente con service role: escribe el registro de evidencia y consume la prueba. */
  admin: SupabaseClient
  userId: string
  action: LadderAction
  /** Leído en el servidor, nunca recibido del cliente. */
  amount: number
  workId?: string | null
  biometricProof?: string | null
}): Promise<LadderVerdict> {
  const { admin, userId, action, amount, workId = null, biometricProof = null } = params

  const { data: resolved, error: resolveError } = await admin.rpc('resolve_auth_ladder', {
    p_action: action,
    p_amount: amount,
  })

  if (resolveError || !resolved) {
    console.error('[auth-ladder] could not resolve the ladder:', resolveError)
    return { ok: false, status: 500, error: 'ladder_unavailable' }
  }

  const rule = Array.isArray(resolved) ? resolved[0] : resolved
  if (!rule) {
    return { ok: false, status: 500, error: 'ladder_unavailable' }
  }

  const needBiometric: boolean = rule.need_biometric
  const needThreeDS: boolean = rule.need_three_ds

  let satisfiedBiometric = false

  if (needBiometric) {
    if (!biometricProof) {
      return { ok: false, status: 428, error: 'biometric_required' }
    }
    // De un solo uso y atómico: dos peticiones no pueden gastar la misma prueba.
    const { data: consumed } = await admin.rpc('consume_biometric_proof', {
      who: userId,
      hash: createHash('sha256').update(biometricProof).digest('hex'),
    })
    if (consumed !== true) {
      return { ok: false, status: 428, error: 'biometric_required' }
    }
    satisfiedBiometric = true
  }

  /**
   * El registro de evidencia — §5.4.
   *
   * Se escribe también cuando no se exigió nada: que la regla se aplicó y con
   * qué umbrales es parte de lo que hay que poder demostrar. Los umbrales van
   * congelados, así que moverlos mañana no reescribe lo de hoy.
   *
   * Si el registro falla, la acción NO se cae. Es evidencia, no un control:
   * negarle una compra a alguien porque no se pudo escribir una fila de
   * auditoría castiga al cliente por un problema nuestro. Se registra el fallo.
   */
  const { error: logError } = await admin.from('money_action_auth').insert({
    user_id: userId,
    action,
    amount,
    work_id: workId,
    required_biometric: needBiometric,
    required_three_ds: needThreeDS,
    required_private_code: false,
    satisfied_biometric: satisfiedBiometric,
    satisfied_private_code: false,
    biometric_threshold_at_time: rule.biometric_threshold,
    three_ds_threshold_at_time: rule.three_ds_threshold,
  })
  if (logError) {
    console.error('[auth-ladder] could not write the evidence record:', logError)
  }

  return { ok: true, requireThreeDS: needThreeDS }
}
