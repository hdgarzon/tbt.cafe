import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getRules, assertNotPaused } from '@/lib/rules'
import { planCommerce, type CommercePatch, type CommerceRow } from '@/lib/commerce'
import type { SellerRow } from '@/lib/seller'

/**
 * POST /api/work/commerce — Work Order 02, Stage 3.1.
 *
 * La unica escritura de work_commerce. La hace quien tiene la obra hoy
 * (`current_owner_id`), que antes del primer cambio de dueno es quien la creo.
 * El navegador ya no puede escribir la fila (060): esta ruta decide, con las
 * reglas de configuracion, y escribe con el service role.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as { workId?: string } & CommercePatch
  if (!body.workId) return NextResponse.json({ error: 'workId_required' }, { status: 400 })
  // Stage 11: poner en venta se pausa; quitar de la venta, nunca.
  if (body.availability === 'for_sale') {
    const paused = await assertNotPaused('selling')
    if (paused) return NextResponse.json(paused, { status: 423 })
  }

  const admin = createAdminClient()
  const [{ data: work }, { data: row }, { data: seller }, rules] = await Promise.all([
    admin.from('works').select('id, current_owner_id').eq('id', body.workId).maybeSingle(),
    admin
      .from('work_commerce')
      .select('availability, initial_price, taking_offers, royalty_type, royalty_value, royalty_locked, frozen_offer_id')
      .eq('work_id', body.workId)
      .maybeSingle(),
    admin.from('seller_accounts').select('status, suspended_at').eq('user_id', auth.user.id).maybeSingle(),
    getRules(),
  ])

  if (!work || !row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (work.current_owner_id !== auth.user.id) return NextResponse.json({ error: 'not_holder' }, { status: 403 })

  const plan = planCommerce(
    row as CommerceRow,
    { availability: body.availability, price: body.price, takingOffers: body.takingOffers, royalty: body.royalty },
    rules,
    seller as Pick<SellerRow, 'status' | 'suspended_at'> | null
  )
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 409 })
  if (Object.keys(plan.update).length === 0) return NextResponse.json({ ok: true, priceLifted: null })

  const { error } = await admin.from('work_commerce').update(plan.update).eq('work_id', body.workId)
  // La base tiene la ultima palabra (059 vendedor, 060 regalia bloqueada).
  if (error) {
    const known = ['seller_not_active', 'royalty_locked'].find((k) => error.message.includes(k))
    return NextResponse.json({ error: known ?? 'commerce_failed' }, { status: known ? 409 : 500 })
  }
  return NextResponse.json({ ok: true, priceLifted: plan.priceLifted })
}
