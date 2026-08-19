import { NextRequest, NextResponse } from 'next/server'
import { verifyTwoFactors } from '@/lib/two-factor'

/**
 * Alta y cambio del destino de payout — Backend Spec 06 §4.1, y Spec 01 §5.1.
 *
 * "Cambio de destino de payout → biométrico + código privado — incondicional,
 * sin umbral." Es la acción más sensible del producto: redirigir el destino es
 * llevarse todo lo que esa persona cobre a partir de ese momento, sin tocar
 * ni una venta. Por eso no hay monto que la exima.
 *
 * El destino completo se guarda para poder disponer el pago; lo que se
 * devuelve y lo que se pinta es solo el enmascarado.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

    const { code, biometricProof, methodId, destination, destinationMasked, network } =
      (await request.json()) as {
        code?: string
        biometricProof?: string
        methodId?: string
        destination?: string
        destinationMasked?: string
        network?: string
      }

    if (typeof methodId !== 'string' || !methodId) {
      return NextResponse.json({ error: 'method_required' }, { status: 400 })
    }
    if (typeof destination !== 'string' || !destination.trim()) {
      return NextResponse.json({ error: 'destination_required' }, { status: 400 })
    }
    if (typeof destinationMasked !== 'string' || !destinationMasked) {
      return NextResponse.json({ error: 'destination_required' }, { status: 400 })
    }

    const gate = await verifyTwoFactors(token, { code, biometricProof })
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })
    const { userId, admin } = gate

    // El método tiene que existir y estar habilitado. Sin esta comprobación se
    // podría guardar un destino contra un método retirado, que luego no tiene
    // rail por donde salir.
    const { data: method } = await admin
      .from('payout_methods')
      .select('id, enabled')
      .eq('id', methodId)
      .maybeSingle()

    if (!method?.enabled) {
      return NextResponse.json({ error: 'method_unavailable' }, { status: 409 })
    }

    // Un solo destino por defecto: se baja el anterior antes de subir el nuevo.
    await admin.from('payout_destinations').update({ is_default: false }).eq('user_id', userId)

    const { error } = await admin.from('payout_destinations').insert({
      user_id: userId,
      method_id: methodId,
      destination: destination.trim(),
      destination_masked: destinationMasked,
      network: network ?? null,
      is_default: true,
    })

    if (error) {
      console.error('[payouts/destination] insert failed:', error)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    }

    return NextResponse.json({ masked: destinationMasked, methodId })
  } catch (error) {
    console.error('[payouts/destination] failed:', error)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
