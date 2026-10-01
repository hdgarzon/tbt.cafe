import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { runChainRecovery } from '@/lib/chain/recovery'

/**
 * GET /api/cron/chain-recovery — el barrido de recuperacion (Chains 01, 7.3).
 *
 * Acuña, mueve y publica: gasta SOL y créditos. Por eso, a diferencia del
 * upgrade de anclas, sin CRON_SECRET no corre nunca.
 *
 * Construido y sin programar: su horario espera la pregunta (s).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }

  const summary = await runChainRecovery(createAdminClient())
  console.log('[chain-recovery]', summary)
  return NextResponse.json(summary)
}
