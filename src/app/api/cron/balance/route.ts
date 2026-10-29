import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { checkPayerBalance, checkStorageCredits } from '@/lib/chain/balance'

/**
 * GET /api/cron/balance — la alarma de saldo (Chains 01, 7.2.2): el SOL del
 * payer y los creditos de la clave de almacenamiento (5.1).
 *
 * Avisa a los operadores una vez por cruce de umbral, por cuenta. Corre cada
 * hora desde Supabase Cron (083, `tbt-balance-alarm`). Si una lectura falla, la
 * otra corre igual y el fallo queda en la respuesta.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }
  const admin = createAdminClient()
  const failed = (error: unknown) => ({ error: error instanceof Error ? error.message : 'check failed' })
  const payer = await checkPayerBalance(admin).catch(failed)
  const storage = await checkStorageCredits(admin).catch(failed)
  console.log('[balance]', { payer, storage })
  const ok = !('error' in payer) && !('error' in storage)
  return NextResponse.json({ payer, storage }, { status: ok ? 200 : 500 })
}
