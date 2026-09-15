import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/notify'

/**
 * El barrido diario de las ganancias retenidas — Backend Spec 01 §4.2.
 *
 * Una ganancia de compra entra `pending` con su ventana de liquidación. Hasta
 * ahora solo pasaba a `available` cuando su dueño abría Cobros
 * (`release_my_due_payout_earnings`, acotada a quien llama), así que el servidor
 * nunca veía el cambio y nadie podía avisar.
 *
 * Dos pasos, y el segundo no depende del primero:
 *
 *  1. Libera lo vencido de todos, con el service role. Es el barrido global que
 *     la 020 ya daba por hecho.
 *  2. Avisa de lo liberado en las últimas 48 horas que sigue disponible. Eso
 *     incluye lo que liberó la pantalla de Cobros antes que el cron: esa fila ya
 *     no está pendiente y el paso 1 no la ve. La clave es la ganancia, así que
 *     dos pasadas seguidas no escriben dos avisos (047).
 *
 * Solo lo que tenía ventana (`releases_at` no nulo): lo liberado por evento entra
 * ya disponible y avisó `payout_available` al escribirse. Y nada ya cobrado: el
 * aviso llegaría tarde.
 */

/** Un día de cron más uno perdido. En Hobby el disparo puede correrse una hora. */
const NOTICE_WINDOW_MS = 48 * 3600 * 1000

const BATCH = 1000

export async function releaseDuePayoutEarnings(
  admin: SupabaseClient
): Promise<{ released: number; considered: number }> {
  const now = new Date().toISOString()

  const { data: moved, error } = await admin
    .from('payout_earnings')
    .update({ state: 'available', released_at: now, hold_reason: null })
    .eq('state', 'pending')
    .not('releases_at', 'is', null)
    .lte('releases_at', now)
    .select('id')

  if (error) {
    console.error('[payout-release] could not release due earnings:', error)
  }

  const since = new Date(Date.now() - NOTICE_WINDOW_MS).toISOString()
  const { data: released, error: readError } = await admin
    .from('payout_earnings')
    .select('id, user_id, amount, work:works(title)')
    .eq('state', 'available')
    .not('releases_at', 'is', null)
    .gte('released_at', since)
    .order('released_at', { ascending: true })
    .limit(BATCH)

  if (readError) {
    console.error('[payout-release] could not read released earnings:', readError)
    return { released: moved?.length ?? 0, considered: 0 }
  }

  const rows = released ?? []
  if (rows.length === BATCH) {
    // Lo que no entra hoy entra mañana, mientras siga dentro de la ventana.
    console.error(`[payout-release] ${BATCH} released earnings in 48 hours: the batch is full`)
  }

  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]
    const work = Array.isArray(e.work) ? e.work[0] : e.work
    await notify(admin, {
      userId: e.user_id,
      eventKey: 'payout_released',
      dedupeKey: e.id,
      data: {
        amount: Number(e.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        title: work?.title ?? '',
      },
      href: '/history/payouts',
    })
  }

  return { released: moved?.length ?? 0, considered: rows.length }
}
