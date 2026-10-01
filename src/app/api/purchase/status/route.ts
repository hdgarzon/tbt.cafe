import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * GET /api/purchase/status?transferId= — /purchase/success solo pregunta
 * (Work Order 02, 0.7b): la venta la completa el webhook, nunca la pagina.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const transferId = request.nextUrl.searchParams.get('transferId')
  if (!transferId) return NextResponse.json({ error: 'transferId_required' }, { status: 400 })

  const { data: t } = await createAdminClient()
    .from('transfers')
    .select('to_owner_id, payment_status, work:works(title, tbt_id)')
    .eq('id', transferId)
    .maybeSingle()
  if (!t || t.to_owner_id !== auth.user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const work = (Array.isArray(t.work) ? t.work[0] : t.work) as { title: string | null; tbt_id: string | null } | null
  return NextResponse.json({ status: t.payment_status, title: work?.title ?? '', tbtId: work?.tbt_id ?? null })
}
