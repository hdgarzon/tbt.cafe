import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { authenticate } from '@/lib/route-auth'

/**
 * Lectura pública y mínima de una transferencia de dos fases, para la vista
 * de aceptar/rechazar en tbt-cafe (reachable por link de SMS, ANTES de que
 * el recipiente inicie sesión — Transfer Companion). Deliberadamente no
 * expone el teléfono de nadie ni ids internos más allá del propio transferId
 * que ya está en la URL que el recipiente recibió.
 */

export async function GET(request: NextRequest, props: { params: Promise<{ transferId: string }> }) {
  const params = await props.params;

  const service = createAdminClient()
  const { data: transfer } = await service
    .from('transfers')
    .select(
      'id, payment_status, outcome, authorized_at, payment_amount, payment_currency, from_owner_name, work:works(title, media_url)'
    )
    .eq('id', params.transferId)
    .eq('is_two_phase', true)
    .maybeSingle()

  if (!transfer) return NextResponse.json({ error: 'transferNotFound' }, { status: 404 })

  const work = Array.isArray(transfer.work) ? transfer.work[0] : transfer.work
  const lapsed =
    transfer.outcome === null &&
    transfer.payment_status === 'pending' &&
    !!transfer.authorized_at &&
    Date.now() - new Date(transfer.authorized_at).getTime() > 24 * 3600 * 1000

  return NextResponse.json({
    id: transfer.id,
    status: transfer.outcome ?? (lapsed ? 'lapsed' : transfer.payment_status === 'pending' ? 'pending' : 'authorizing'),
    workTitle: work?.title ?? '',
    workMediaUrl: work?.media_url ?? null,
    senderName: transfer.from_owner_name,
    value: transfer.payment_amount,
    currency: transfer.payment_currency ?? 'USD',
  })
}
