import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { makeOffer, offerContext } from '@/lib/offers-server'
import { assertNotPaused } from '@/lib/rules'

/**
 * Ofertas — Work Order 02, Stage 4.2.
 *
 * GET ?workId= dice lo que el navegador avisa antes de enviar: si quien tiene
 * la obra esta aprobado para vender (S-2) y si su pais tiene cobro. POST hace
 * la oferta; las reglas estan en `offers.ts` y la escritura en `offers-server.ts`.
 */
export async function GET(request: NextRequest) {
  const workId = new URL(request.url).searchParams.get('workId')
  if (!workId) return NextResponse.json({ error: 'workId_required' }, { status: 400 })
  const ctx = await offerContext(workId)
  return ctx ? NextResponse.json(ctx) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const body = (await request.json().catch(() => ({}))) as { workId?: string; amount?: unknown; durationHours?: unknown; message?: unknown }
  if (!body.workId) return NextResponse.json({ error: 'workId_required' }, { status: 400 })
  // Stage 11: ninguna oferta nueva con las ofertas en pausa.
  const paused = await assertNotPaused('offers')
  if (paused) return NextResponse.json(paused, { status: 423 })
  const result = await makeOffer(auth.user.id, body.workId, { amount: body.amount, durationHours: body.durationHours, message: body.message })
  if ('error' in result && result.error) {
    return NextResponse.json(result, { status: result.error === 'not_found' ? 404 : result.error === 'offer_failed' ? 500 : 409 })
  }
  return NextResponse.json(result)
}
