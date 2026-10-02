import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * GET /api/purchase/context?workId= — lo que la hoja de compra dice antes del
 * cargo (Work Order 02, 0.8): si es la primera compra (la linea de los Terms),
 * que nombre mostrara el estado de cuenta, y la preseleccion de la pregunta del
 * nombre a partir del interruptor de anonimato.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const workId = request.nextUrl.searchParams.get('workId')
  if (!workId) return NextResponse.json({ error: 'workId_required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: work } = await admin.from('works').select('current_owner_id').eq('id', workId).maybeSingle()
  if (!work) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [{ count }, { data: seller }, { data: holder }, { data: me }] = await Promise.all([
    admin.from('terms_acceptances').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id),
    admin.from('seller_accounts').select('charge_path').eq('user_id', work.current_owner_id).maybeSingle(),
    admin.from('profiles').select('public_alias, display_name').eq('id', work.current_owner_id).maybeSingle(),
    admin.from('profiles').select('collector_anonymous').eq('id', auth.user.id).maybeSingle(),
  ])

  return NextResponse.json({
    firstPurchase: !count,
    path: seller?.charge_path === 'direct' ? 'direct' : 'platform',
    sellerName: holder?.public_alias || holder?.display_name || null,
    // 0.8a: No si es anonimo, Si si no.
    nameByDefault: !me?.collector_anonymous,
  })
}
