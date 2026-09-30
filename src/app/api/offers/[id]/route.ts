import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { actOnOffer, offerDetail, type OfferAction } from '@/lib/offers-server'

/**
 * Responder a una oferta — Work Order 02, Stage 4.3, 4.4, 4.6 y 4.11.
 *
 * accept y decline (quien tiene la obra), withdraw (quien oferto), cancel por
 * falta de pago (quien tiene la obra, pasada la ventana) y report (cualquiera
 * de los dos, sobre el mensaje del otro).
 */
/** La oferta, para una de sus dos partes. A cualquier otra persona, 404. */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { id } = await props.params
  const detail = await offerDetail(auth.user.id, id)
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

const ACTIONS: OfferAction[] = ['accept', 'decline', 'withdraw', 'cancel', 'report']

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { id } = await props.params
  const body = (await request.json().catch(() => ({}))) as { action?: OfferAction; reply?: unknown; which?: 'message' | 'response' }
  if (!body.action || ACTIONS.indexOf(body.action) === -1) return NextResponse.json({ error: 'unknown_action' }, { status: 400 })

  const result = await actOnOffer(auth.user.id, id, body.action, body.reply, body.which)
  if ('error' in result && result.error) {
    const status = result.error === 'not_found' ? 404 : ['not_party', 'not_holder', 'not_offerer'].indexOf(result.error) !== -1 ? 403 : 409
    return NextResponse.json(result, { status })
  }
  return NextResponse.json(result)
}
