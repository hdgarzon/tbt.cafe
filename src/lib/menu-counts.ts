import { supabase } from '@/lib/supabase'

/**
 * Los contadores del cajón de menú.
 *
 * Son conteos de filas, como en el prototipo: cuántas cosas hay en cada vista.
 * No son "cuántas te reclaman" — un badge de atención sería otra cosa y el
 * prototipo no lo pide. En cero no se pinta nada: una píldora permanente con
 * un número que nunca cambia deja de mirarse.
 *
 * El contador de la sección es la SUMA de sus hijos, así que se calcula aquí y
 * no en el menú, para que no haya dos maneras de sumarlo.
 *
 * Todo va en una tanda de consultas `head: true`: al menú le importa cuántos,
 * no cuáles, y traer las filas para contarlas sería pagar por datos que nadie
 * pinta.
 */

export type MenuCounts = {
  offersMade: number
  offersReceived: number
  transfersIn: number
  transfersOut: number
  payouts: number
  brews: number
  royalties: number
  purchased: number
  sales: number
}

export const EMPTY_COUNTS: MenuCounts = {
  offersMade: 0,
  offersReceived: 0,
  transfersIn: 0,
  transfersOut: 0,
  payouts: 0,
  brews: 0,
  royalties: 0,
  purchased: 0,
  sales: 0,
}

/** `count` con `head: true` no trae filas: solo el número. */
async function countOf(
  table: string,
  build: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>
): Promise<number> {
  const { count, error } = await build(baseQuery(table))
  return error ? 0 : (count ?? 0)
}

function baseQuery(table: string) {
  return supabase.from(table).select('id', { count: 'exact', head: true })
}

export async function fetchMenuCounts(userId: string): Promise<MenuCounts> {
  const [
    offersMade,
    offersReceived,
    transfersIn,
    transfersOut,
    payouts,
    brews,
    purchased,
    sales,
    royalties,
  ] = await Promise.all([
    countOf('offers', (q) => q.eq('from_user', userId)),
    // Recibidas: sobre obras propias y hechas por otro.
    countOf('offers', (q) => q.neq('from_user', userId)),
    countOf('transfers', (q) => q.eq('to_owner_id', userId)),
    countOf('transfers', (q) => q.eq('from_owner_id', userId)),
    // Solo lo cobrable. Lo pendiente existe pero todavía no se puede tocar,
    // y un badge que lo incluyera prometería un cobro que va a fallar.
    countOf('payout_earnings', (q) => q.eq('user_id', userId).eq('state', 'available')),
    countOf('works', (q) => q.eq('creator_id', userId).eq('status', 'certified')),
    countOf('transfers', (q) => q.eq('to_owner_id', userId).eq('payment_status', 'completed')),
    countOf('transfers', (q) => q.eq('from_owner_id', userId).eq('payment_status', 'completed')),
    // Las regalías se derivan de ownership_history y no tienen tabla propia,
    // así que no hay un `count` barato: se cuenta sobre las obras del creador
    // que han cambiado de manos con precio.
    countRoyalties(userId),
  ])

  return {
    offersMade,
    offersReceived,
    transfersIn,
    transfersOut,
    payouts,
    brews,
    purchased,
    sales,
    royalties,
  }
}

async function countRoyalties(userId: string): Promise<number> {
  const { data: works } = await supabase.from('works').select('id').eq('creator_id', userId)
  const ids = (works ?? []).map((w) => w.id)
  if (!ids.length) return 0

  const { count } = await supabase
    .from('ownership_history')
    .select('id', { count: 'exact', head: true })
    .in('work_id', ids)
    .eq('event_type', 'transfer')
    .neq('owner_user_id', userId)
    .not('price', 'is', null)

  return count ?? 0
}

/** Total de una sección — la suma de sus hijos, en un solo sitio. */
export function sectionTotal(...counts: number[]): number {
  return counts.reduce((total, n) => total + n, 0)
}
