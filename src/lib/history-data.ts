import { supabase } from '@/lib/supabase'
import { royaltyAmountOf, type Royalty } from '@/lib/fees'

/**
 * Capa de datos de las cinco vistas de Transactions (Build Spec 02, ÍTEM 6 —
 * Brews / Offers / Royalties / Transfers / Sales). Transfers ya tenía su
 * propia página real (src/app/history/transactions); estas cuatro
 * completan el resto — cada una lee datos reales, ninguna es simulada.
 */

export type BrewRow = { id: string; tbtId: string; title: string; when: string; fee: number }

/** Obras que el usuario certificó — con su tarifa fija de $8 (Spec 01, ítem 2). */
export async function fetchBrews(userId: string): Promise<BrewRow[]> {
  const { data } = await supabase
    .from('works')
    .select('id, tbt_id, title, certified_at')
    .eq('creator_id', userId)
    .eq('status', 'certified')
    .order('certified_at', { ascending: false })

  return (data ?? [])
    .filter((w) => w.certified_at)
    .map((w) => ({ id: w.id, tbtId: w.tbt_id, title: w.title, when: w.certified_at as string, fee: 8 }))
}

export type OfferRow = {
  id: string
  tbtId: string
  title: string
  when: string
  direction: 'made' | 'received'
  counterparty: string | null
  status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
  amount: number
}

/** Ofertas hechas por el usuario + recibidas sobre obras que posee, fusionadas y ordenadas. */
export async function fetchOffersLedger(userId: string): Promise<OfferRow[]> {
  const [{ data: made }, { data: ownedWorks }] = await Promise.all([
    supabase
      .from('offers')
      .select('id, amount, status, created_at, work:works(tbt_id, title)')
      .eq('from_user', userId)
      .order('created_at', { ascending: false }),
    supabase.from('works').select('id, tbt_id, title').eq('current_owner_id', userId),
  ])

  const madeRows: OfferRow[] = (made ?? []).map((o) => {
    const work = Array.isArray(o.work) ? o.work[0] : o.work
    return {
      id: o.id,
      tbtId: work?.tbt_id ?? '',
      title: work?.title ?? '',
      when: o.created_at,
      direction: 'made' as const,
      counterparty: null,
      status: o.status,
      amount: Number(o.amount),
    }
  })

  const ownedIds = (ownedWorks ?? []).map((w) => w.id)
  let receivedRows: OfferRow[] = []
  if (ownedIds.length) {
    const { data: received } = await supabase
      .from('offers')
      .select('id, amount, status, created_at, work_id, from_user')
      .in('work_id', ownedIds)
      .neq('from_user', userId)
      .order('created_at', { ascending: false })

    const fromIds = Array.from(new Set((received ?? []).map((o) => o.from_user)))
    const { data: offerers } = fromIds.length
      ? await supabase.from('profiles').select('id, display_name, public_alias').in('id', fromIds)
      : { data: [] as { id: string; display_name: string | null; public_alias: string | null }[] }
    const nameOf = new Map((offerers ?? []).map((p) => [p.id, p.public_alias || p.display_name || null]))
    const workOf = new Map((ownedWorks ?? []).map((w) => [w.id, w]))

    receivedRows = (received ?? []).map((o) => {
      const w = workOf.get(o.work_id)
      return {
        id: o.id,
        tbtId: w?.tbt_id ?? '',
        title: w?.title ?? '',
        when: o.created_at,
        direction: 'received' as const,
        counterparty: nameOf.get(o.from_user) ?? null,
        status: o.status,
        amount: Number(o.amount),
      }
    })
  }

  return [...madeRows, ...receivedRows].sort((a, b) => (a.when < b.when ? 1 : -1))
}

export type RoyaltyRow = { id: string; tbtId: string; title: string; when: string; royalty: Royalty; amount: number }

/**
 * Regalías pagadas al usuario como creador — derivadas de ownership_history
 * (no hay una tabla de regalías dedicada). Un evento 'transfer' en una obra
 * que el usuario creó, donde el nuevo dueño no es el propio usuario, implica
 * una reventa; la regalía se resuelve por los términos canónicos de la obra.
 */
export async function fetchRoyalties(userId: string): Promise<RoyaltyRow[]> {
  const { data: myWorks } = await supabase
    .from('works')
    .select('id, tbt_id, title, commerce:work_commerce(royalty_type, royalty_value)')
    .eq('creator_id', userId)
  const works = myWorks ?? []
  if (!works.length) return []

  const workIds = works.map((w) => w.id)
  const { data: events } = await supabase
    .from('ownership_history')
    .select('id, work_id, event_type, owner_user_id, price, created_at')
    .in('work_id', workIds)
    .eq('event_type', 'transfer')
    .neq('owner_user_id', userId)
    .not('price', 'is', null)
    .order('created_at', { ascending: false })

  const workOf = new Map(works.map((w) => [w.id, w]))
  return (events ?? [])
    .map((e) => {
      const w = workOf.get(e.work_id)
      const commerce = Array.isArray(w?.commerce) ? w?.commerce[0] : w?.commerce
      // Toda ruta de dinero resuelve por royaltyAmountOf; ningún sitio calcula
      // valor × pct por su cuenta (Spec 01 §2.1).
      const r: Royalty = commerce
        ? { type: commerce.royalty_type, value: commerce.royalty_value }
        : { type: 'percentage', value: 10 }
      const price = Number(e.price)
      if (!price) return null
      return {
        id: e.id,
        tbtId: w?.tbt_id ?? '',
        title: w?.title ?? '',
        when: e.created_at,
        royalty: r,
        amount: Math.round(royaltyAmountOf(r, price) * 100) / 100,
      }
    })
    .filter((r): r is RoyaltyRow => r !== null)
}

export type SaleRow = { id: string; tbtId: string; title: string; when: string; buyerName: string | null; amount: number }

/** Ventas completadas por el usuario (emisor de una transferencia pagada que se completó). */
export async function fetchSales(userId: string): Promise<SaleRow[]> {
  const { data } = await supabase
    .from('transfers')
    .select('id, work_id, sale_price, payment_amount, new_owner_name, payment_status, outcome, completed_at, initiated_at, work:works(tbt_id, title)')
    .eq('from_owner_id', userId)
    .order('initiated_at', { ascending: false })

  return (data ?? [])
    .filter((t) => t.payment_status === 'completed' || t.outcome === 'accepted')
    .map((t) => {
      const work = Array.isArray(t.work) ? t.work[0] : t.work
      const amount = Number(t.sale_price ?? t.payment_amount ?? 0)
      return {
        id: t.id,
        tbtId: work?.tbt_id ?? '',
        title: work?.title ?? '',
        when: t.completed_at ?? t.initiated_at,
        buyerName: t.new_owner_name,
        amount,
      }
    })
    .filter((r) => r.amount > 0)
}

export type PurchaseRow = {
  id: string
  tbtId: string
  title: string
  when: string
  sellerName: string | null
  amount: number
}

/**
 * Obras que el usuario COMPRÓ — el espejo de `fetchSales`.
 *
 * Existe como vista propia porque Transactions es la mirada de dinero: qué
 * salió y qué entró. `/collections/acquisitions` enseña lo mismo como
 * colección —qué tengo— que es otra pregunta.
 */
export async function fetchPurchased(userId: string): Promise<PurchaseRow[]> {
  const { data } = await supabase
    .from('transfers')
    .select('id, sale_price, payment_amount, from_owner_name, payment_status, outcome, completed_at, initiated_at, work:works(tbt_id, title)')
    .eq('to_owner_id', userId)
    .order('initiated_at', { ascending: false })

  return (data ?? [])
    .filter((t) => t.payment_status === 'completed' || t.outcome === 'accepted')
    .map((t) => {
      const work = Array.isArray(t.work) ? t.work[0] : t.work
      return {
        id: t.id,
        tbtId: work?.tbt_id ?? '',
        title: work?.title ?? '',
        when: t.completed_at ?? t.initiated_at,
        sellerName: t.from_owner_name ?? null,
        amount: Number(t.sale_price ?? t.payment_amount ?? 0),
      }
    })
    .filter((r) => r.amount > 0)
}
