import { supabase } from '@/lib/supabase'

/**
 * Capa de datos de Ofertas (Build Spec 02, Ítem 5, migración 009) — ledger
 * ligero para que una oferta sobre una obra en venta y una aproximación no
 * solicitada sobre una obra que no está en venta queden ambas registradas.
 */

export type OfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired'

export type MyOffer = {
  id: string
  work_id: string
  work_title: string
  work_tbt_id: string
  amount: number
  currency: string
  status: OfferStatus
  solicited: boolean
  created_at: string
}

/** Envía una oferta. `solicited` refleja si la obra estaba en venta al momento de ofertar. */
export async function makeOffer(
  workId: string,
  amount: number,
  solicited: boolean
): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'needSignIn' }

  const { error } = await supabase.from('offers').insert({
    work_id: workId,
    from_user: user.id,
    amount,
    currency: 'USD',
    solicited,
  })
  return error ? { error: error.message } : {}
}

/** Ofertas hechas por el usuario actual, más recientes primero. */
export async function fetchMyOffers(): Promise<MyOffer[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('offers')
    .select('id, work_id, amount, currency, status, solicited, created_at, work:works(title, tbt_id)')
    .eq('from_user', user.id)
    .order('created_at', { ascending: false })

  return (data ?? []).map((o) => {
    const work = Array.isArray(o.work) ? o.work[0] : o.work
    return {
      id: o.id,
      work_id: o.work_id,
      work_title: work?.title ?? '',
      work_tbt_id: work?.tbt_id ?? '',
      amount: Number(o.amount),
      currency: o.currency,
      status: o.status as OfferStatus,
      solicited: o.solicited,
      created_at: o.created_at,
    }
  })
}
