import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'
import { planDeliveryDetails, type DeliveryChoice, type DeliveryDetailsInput } from '@/lib/delivery'

/**
 * POST /api/delivery/details — quien vende da los datos de entrega.
 * Work Order 02, Amendment Delivery 01 (decision 94), Stage 7.
 *
 * Solo el vendedor de esa venta, tomado de la sesion y nunca del cuerpo. El
 * tipo de los datos lo da lo que eligio el comprador. En la via de plataforma
 * darlos suelta la retencion de la ganancia, en la misma transaccion que los
 * guarda (081).
 *
 * NO va detras de DELIVERY_LIVE: todo parte de una fila de sale_deliveries que
 * ya existe. Si la entrega se apagara con ventas retenidas, quien vende tiene
 * que poder seguir dando sus datos para cobrar.
 */
const KNOWN = ['not_found', 'not_seller', 'sale_not_completed', 'no_details_needed'] as const

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as { transferId?: string } & DeliveryDetailsInput
  if (!body.transferId) return NextResponse.json({ error: 'transferId_required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('sale_deliveries')
    .select('choice, seller_id, buyer_id, work:works(title, tbt_id)')
    .eq('transfer_id', body.transferId)
    .maybeSingle()
  // Una venta ajena se responde igual que una que no existe.
  if (!row || row.seller_id !== auth.user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const plan = planDeliveryDetails(row.choice as DeliveryChoice, body)
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 })

  const { data, error } = await admin.rpc('submit_delivery_details', {
    p_transfer: body.transferId,
    p_seller: auth.user.id,
    p_details: plan.details,
  })
  if (error) {
    const known = KNOWN.find((k) => error.message.includes(k))
    return NextResponse.json({ error: known ?? 'details_failed' }, { status: known === 'not_found' || known === 'not_seller' ? 404 : known ? 409 : 500 })
  }
  const result = data as { submitted?: boolean; released?: number } | null

  // Quien compra se entera de la respuesta, una vez. Sin la direccion: es suya.
  if (result?.submitted) {
    const work = (Array.isArray(row.work) ? row.work[0] : row.work) as { title?: string; tbt_id?: string } | null
    await notify(admin, {
      userId: row.buyer_id,
      eventKey: 'delivery_details_received',
      dedupeKey: `${body.transferId}:delivery_details`,
      data: { title: work?.title ?? '', kind: plan.kind, ...plan.details },
      href: work?.tbt_id ? `/work/${work.tbt_id}` : undefined,
    })
  }

  return NextResponse.json({ ok: true, submitted: result?.submitted === true, released: result?.released ?? 0 })
}
