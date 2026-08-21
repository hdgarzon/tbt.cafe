import { NextRequest, NextResponse } from 'next/server'
import { verifyTwoFactors } from '@/lib/two-factor'
import { disburseBlock } from '@/lib/payout-disburse'

/**
 * Cobro de un bloque de payout — Backend Spec 02 §4, y Spec 01 §5.1.
 *
 * Los dos factores son INCONDICIONALES aquí: biométrico + código privado en
 * cada cobro, sin umbral. El dinero saliendo de la plataforma es el objetivo
 * de mayor valor para un secuestro de cuenta, y el código privado es el único
 * factor que un teléfono robado y desbloqueado no puede aportar.
 *
 * El biométrico se comprueba consumiendo una prueba emitida por
 * /api/webauthn (la única ruta que verifica la aserción), igual que el step-up
 * de administración. Un booleano `biometric: true` del cliente no es una
 * comprobación: quien haga un POST directo lo afirma solo.
 *
 * El MONTO NO VIENE DE AQUÍ. El cliente manda qué ganancias quiere cobrar; la
 * función `create_payout_block` bloquea esas filas, comprueba que sean suyas y
 * estén disponibles, y suma en la base. Confiar en un total del cliente sería
 * dejar que decida cuánto se le paga.
 */

/** Los errores que la función SQL levanta, traducidos a códigos de respuesta. */
const SQL_ERRORS: Record<string, { status: number; error: string }> = {
  method_unavailable: { status: 409, error: 'method_unavailable' },
  earnings_unavailable: { status: 409, error: 'earnings_unavailable' },
  below_minimum: { status: 400, error: 'below_minimum' },
  above_maximum: { status: 400, error: 'above_maximum' },
  net_not_positive: { status: 400, error: 'net_not_positive' },
  not_authenticated: { status: 401, error: 'not_authenticated' },
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

    const { code, biometricProof, methodId, destination, destinationMasked, earningIds } =
      (await request.json()) as {
        code?: string
        biometricProof?: string
        methodId?: string
        destination?: string
        destinationMasked?: string
        earningIds?: string[]
      }

    if (typeof methodId !== 'string' || !methodId) {
      return NextResponse.json({ error: 'method_required' }, { status: 400 })
    }
    if (!Array.isArray(earningIds) || earningIds.length === 0) {
      return NextResponse.json({ error: 'earnings_required' }, { status: 400 })
    }

    // Biométrico + código privado, incondicionales (§5.1).
    const gate = await verifyTwoFactors(token, { code, biometricProof })
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })
    const { userId, admin } = gate

    // El destino completo se guarda solo si la persona escribió uno nuevo; el
    // enmascarado es lo único que viaja al bloque y a la pantalla.
    const masked = typeof destinationMasked === 'string' ? destinationMasked : ''
    if (!masked) return NextResponse.json({ error: 'destination_required' }, { status: 400 })

    // El usuario va por parámetro, no por `auth.uid()`. La función está
    // revocada para `authenticated` precisamente para que solo se pueda
    // ejecutar desde aquí, después de los dos factores; si el cliente pudiera
    // llamarla, un POST directo se los saltaría.
    //
    // Dentro sigue verificando propiedad, estado y montos: esta ruta dice QUIÉN
    // cobra, la base decide QUÉ puede cobrar y CUÁNTO suma.
    const { data, error } = await admin.rpc('create_payout_block', {
      p_user_id: userId,
      p_method_id: methodId,
      p_destination_masked: masked,
      p_earning_ids: earningIds,
    })

    if (error) {
      const known = Object.keys(SQL_ERRORS).find((key) => error.message.includes(key))
      if (known) return NextResponse.json(SQL_ERRORS[known], { status: SQL_ERRORS[known].status })
      console.error('[payouts/collect] rpc failed:', error)
      return NextResponse.json({ error: 'collect_failed' }, { status: 500 })
    }

    const block = Array.isArray(data) ? data[0] : data
    if (!block) return NextResponse.json({ error: 'collect_failed' }, { status: 500 })

    // Guardar el destino como el nuevo por defecto solo cuando llegó completo.
    // El §5.1 exige biométrico + código privado para cambiarlo, y los dos
    // acaban de verificarse arriba, así que este es el momento legítimo.
    if (typeof destination === 'string' && destination.trim()) {
      await admin.from('payout_destinations').update({ is_default: false }).eq('user_id', userId)
      await admin.from('payout_destinations').insert({
        user_id: userId,
        method_id: methodId,
        destination: destination.trim(),
        destination_masked: masked,
        is_default: true,
      })
    }

    /**
     * La disposición, ahora sí.
     *
     * Se espera en vez de dispararse y olvidarse: quien pulsa cobrar merece
     * saber si salió. Y si falla, `fail_payout_block` devuelve las ganancias a
     * `available` en la misma pasada, así que puede reintentar en vez de ver su
     * dinero atrapado en un estado del que no se sale.
     */
    const outcome = await disburseBlock(admin, userId, block.block_id, Number(block.net))

    return NextResponse.json({
      blockId: block.block_id,
      gross: Number(block.gross),
      platformFee: Number(block.platform_fee),
      methodFee: Number(block.method_fee),
      net: Number(block.net),
      status: outcome.status,
      ...(outcome.status === 'failed' ? { reason: outcome.reason } : {}),
    })
  } catch (error) {
    console.error('[payouts/collect] failed:', error)
    return NextResponse.json({ error: 'collect_failed' }, { status: 500 })
  }
}
