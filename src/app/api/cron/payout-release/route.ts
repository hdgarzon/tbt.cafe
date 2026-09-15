import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { cronAuthorised } from '@/lib/cron-auth'
import { releaseDuePayoutEarnings } from '@/lib/payout-release'

/**
 * Libera las ganancias cuya ventana de liquidación venció y avisa a sus dueños.
 * El porqué está en `src/lib/payout-release.ts`.
 */

// Dinámica, o el build la ejecuta una vez y congela la respuesta (ver anchor-upgrade).
export const dynamic = 'force-dynamic'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const result = await releaseDuePayoutEarnings(admin)

  console.log(`[payout-release] released ${result.released}, ${result.considered} considered for a notice`)
  return NextResponse.json(result)
}
