import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Transferencias — Work Order 02, Stage 5.
 */

export type ValueKind = 'declared' | 'gift' | 'sale' | 'restoring'

/** Una transferencia con valor lo declara quien envia; sin valor es un regalo (5.3). */
export function valueKindOf(value: number): ValueKind {
  return value > 0 ? 'declared' : 'gift'
}

/**
 * El ultimo valor registrado de la obra (5.7): el de su ultimo cambio de dueno
 * con precio, o el que se declaro al registrarla. La escalera mira el mayor
 * entre este y el declarado, asi que regalar una obra de 12.000 USD sigue
 * pidiendo el biometrico.
 */
export async function lastRecordedValue(db: SupabaseClient, workId: string): Promise<number> {
  const [{ data: last }, { data: commerce }] = await Promise.all([
    db
      .from('ownership_history')
      .select('price')
      .eq('work_id', workId)
      .not('price', 'is', null)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('work_commerce').select('initial_price').eq('work_id', workId).maybeSingle(),
  ])
  const fromHistory = Number(last?.price ?? 0) || 0
  const registered = Number(commerce?.initial_price ?? 0) || 0
  return Math.max(fromHistory, registered)
}

/** Los dos telefonos en E.164, comparados por sus digitos (5.2). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const digits = (p: string | null | undefined) => (p ?? '').replace(/[^\d]/g, '')
  const x = digits(a)
  const y = digits(b)
  return x.length >= 8 && x === y
}
