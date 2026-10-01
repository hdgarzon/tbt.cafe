import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * POST /api/purchase/acknowledge — el «Entendido» de la confirmacion (Work
 * Order 02, 0.9a). Uno, con su hora; sin opcion de rechazo. Es evidencia de
 * disputa (8.1). Un problema va a una solicitud de ayuda.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { transferId } = (await request.json().catch(() => ({}))) as { transferId?: string }
  if (!transferId) return NextResponse.json({ error: 'transferId_required' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('transfers')
    .update({ confirmation_acknowledged_at: new Date().toISOString() })
    .eq('id', transferId)
    .eq('to_owner_id', auth.user.id)
    .eq('payment_status', 'completed')
    .is('confirmation_acknowledged_at', null)
  if (error) return NextResponse.json({ error: 'acknowledge_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
