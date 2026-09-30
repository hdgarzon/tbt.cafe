import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Las ventas limpias de cada vendedor — Work Order 02, Stage 6.3.
 *
 * Una venta es limpia cuando su ganancia ya se libero y su cargo no tuvo
 * disputa. Se cuenta de nuevo en cada barrido y se escribe el total, no se
 * suma: correrlo dos veces deja lo mismo. De esto depende cuando deja de ser
 * «nuevo» un vendedor de la via de plataforma (payout_release_at, 064).
 */
export async function countCleanSales(admin: SupabaseClient): Promise<{ sellers: number }> {
  const { data: earnings } = await admin
    .from('payout_earnings')
    .select('user_id, source_ref, released_at')
    .eq('source', 'sale')
    .in('state', ['available', 'collected'])
    .not('released_at', 'is', null)

  const rows = (earnings ?? []) as { user_id: string; source_ref: string | null; released_at: string }[]
  if (!rows.length) return { sellers: 0 }

  const refs = Array.from(new Set(rows.map((r) => r.source_ref).filter(Boolean))) as string[]
  const { data: disputed } = refs.length
    ? await admin.from('payment_disputes').select('transfer_id').eq('kind', 'dispute').in('transfer_id', refs)
    : { data: [] as { transfer_id: string }[] }
  const dirty = new Set((disputed ?? []).map((d) => d.transfer_id))

  const bySeller = new Map<string, { count: number; first: string }>()
  for (const r of rows) {
    if (r.source_ref && dirty.has(r.source_ref)) continue
    const cur = bySeller.get(r.user_id)
    if (!cur) bySeller.set(r.user_id, { count: 1, first: r.released_at })
    else {
      cur.count++
      if (r.released_at < cur.first) cur.first = r.released_at
    }
  }

  for (const [userId, v] of Array.from(bySeller.entries())) {
    await admin.from('seller_accounts').update({ clean_sales: v.count, first_clean_sale_at: v.first }).eq('user_id', userId)
  }
  return { sellers: bySeller.size }
}
