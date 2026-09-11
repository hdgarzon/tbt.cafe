import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El ID de una obra: tres letras sacadas del titulo y cuatro digitos, como
 * RRO5501. Lo pone la base al insertar (migracion 045); aqui solo se reconoce.
 */
export const TBT_ID_PATTERN = /^[A-Z]{3}[0-9]{4}$/

/**
 * La forma que se emitio por error hasta la migracion 045. Existe solo para que
 * los enlaces ya compartidos sigan llegando: nada nuevo la produce.
 */
export const LEGACY_TBT_ID_PATTERN = /^TBT-[0-9]{4}-[A-Z0-9]{6}$/

/**
 * El ID actual de una obra a partir del que tuvo antes.
 *
 * Devuelve null si lo que llega no tiene la forma antigua, o si no corresponde a
 * ninguna obra que ese cliente pueda ver. Con el cliente anonimo respeta la RLS:
 * lo que antes no se veia, tampoco se redirige ahora.
 *
 * Antes de aplicar la migracion la columna no existe; la consulta falla, esto
 * devuelve null y la obra se sigue encontrando por el ID de siempre. Por eso el
 * codigo puede salir antes que el SQL.
 */
export async function currentTbtIdFor(client: SupabaseClient, id: string): Promise<string | null> {
  if (!LEGACY_TBT_ID_PATTERN.test(id)) return null
  const { data } = await client
    .from('works')
    .select('tbt_id')
    .eq('legacy_tbt_id', id)
    .maybeSingle()
  return data?.tbt_id ?? null
}
