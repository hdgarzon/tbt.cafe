import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { cronAuthorised } from '@/lib/cron-auth'
import { lapseUnansweredTransfers } from '@/lib/transfer-lapse'

/**
 * Vence las transferencias de dos fases que nadie respondió en 24 horas: suelta
 * la retención, las marca y avisa a quien envió. El porqué está en
 * `src/lib/transfer-lapse.ts`.
 */

// Dinámica, o el build la ejecuta una vez y congela la respuesta (ver anchor-upgrade).
export const dynamic = 'force-dynamic'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const result = await lapseUnansweredTransfers(admin)

  console.log(`[transfer-lapse] checked ${result.checked}: ${result.lapsed} lapsed, ${result.skipped} left open`)
  return NextResponse.json(result)
}
