import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { cronAuthorised } from '@/lib/cron-auth'
import { recordProviderEvent } from '@/lib/provider-events'
import { sweepOffers } from '@/lib/offer-sweep'
import { lapseUnansweredTransfers } from '@/lib/transfer-lapse'
import { releaseDuePayoutEarnings } from '@/lib/payout-release'
import { countCleanSales } from '@/lib/seller-settlement'

/**
 * El barrido — Work Order 02, Stage 6.1.
 *
 * Supabase Cron lo llama cada 15 minutos con CRON_SECRET (064). Cada tarea va
 * en su propio try: una que falla no tumba a las demas, y su resultado queda en
 * provider_events, que ya lee la vista de observabilidad. Todas son
 * idempotentes: correr dos veces el mismo cuarto de hora no hace nada dos veces.
 *
 * Aqui: los relojes de las ofertas (4.6, 4.7), el vencimiento de transferencias,
 * la liberacion de ganancias con su aviso, y las ventas limpias (6.3). Lo que
 * falta se suma cuando exista: el castigo de saldo negativo (8.3) y la entrega
 * pendiente de titulos con el aviso del dia 25 (Work Order 01, 17 y 18).
 */

// Dinamica, o el build la ejecuta una vez y congela la respuesta.
export const dynamic = 'force-dynamic'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }
  const admin = createAdminClient()
  const results: Record<string, unknown> = {}

  async function step(name: string, fn: () => Promise<unknown>) {
    const started = Date.now()
    try {
      results[name] = await fn()
      await recordProviderEvent({ provider: 'scheduler', operation: name, ok: true, latencyMs: Date.now() - started })
    } catch (error) {
      results[name] = { error: error instanceof Error ? error.message : String(error) }
      await recordProviderEvent({ provider: 'scheduler', operation: name, ok: false, error, latencyMs: Date.now() - started })
    }
  }

  await step('offer_clocks', () => sweepOffers(admin))
  await step('transfer_lapse', () => lapseUnansweredTransfers(admin))
  await step('earnings_release', () => releaseDuePayoutEarnings(admin))
  await step('clean_sales', () => countCleanSales(admin))

  return NextResponse.json(results)
}
