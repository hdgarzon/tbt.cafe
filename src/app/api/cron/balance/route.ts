import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { checkPayerBalance } from '@/lib/chain/balance'

/**
 * GET /api/cron/balance — la alarma de saldo del payer (Chains 01, 7.2.2).
 *
 * Avisa a los operadores una vez por cruce de umbral. Construida y sin
 * programar: su horario espera la pregunta (s).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }
  const outcome = await checkPayerBalance(createAdminClient())
  console.log('[balance]', outcome)
  return NextResponse.json(outcome)
}
