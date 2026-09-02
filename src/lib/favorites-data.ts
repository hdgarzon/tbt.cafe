import { supabase } from '@/lib/supabase'

/**
 * Capa de datos de Favoritos (Build Spec 02, Decisión 3, migración 007).
 * Clave compuesta (user_id, target_type, target_id) — guardar dos veces es
 * un no-op, quitar es un delete directo por clave. Nunca por rutas/slugs,
 * para que renombrar una serie jamás deje huérfano un favorito.
 */

export type FavoriteTargetType = 'creator' | 'series' | 'work'

export async function isFavorited(targetType: FavoriteTargetType, targetId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('favorites')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle()
  return !!data
}

/**
 * Alterna el favorito y devuelve el nuevo estado, o dice que falta sesión.
 *
 * Devolvía `false` sin sesión, y quien llamaba lo metía tal cual en el estado
 * del corazón: no se llenaba, no se guardaba nada y no se decía nada. Tocar y
 * que la interfaz no reaccione es indistinguible de que esté rota.
 *
 * La capa de datos INFORMA, no decide. `{ error: 'needSignIn' }` es la forma de
 * la casa —`offers-data.ts` y `curation-data.ts` ya la usan— y este archivo era
 * el único que se salía de ella. Quien llama decide qué hacer, que en la
 * interfaz es abrir la autenticación y reanudar.
 */
export async function toggleFavorite(
  targetType: FavoriteTargetType,
  targetId: string
): Promise<boolean | { error: 'needSignIn' }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'needSignIn' as const }

  const already = await isFavorited(targetType, targetId)
  if (already) {
    await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
    return false
  }
  await supabase.from('favorites').insert({ user_id: user.id, target_type: targetType, target_id: targetId })
  return true
}

export type FavoriteRow = { target_type: FavoriteTargetType; target_id: string; created_at: string }

/** Todos los favoritos del usuario actual, más recientes primero. */
export async function listFavorites(): Promise<FavoriteRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('favorites')
    .select('target_type, target_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  return data ?? []
}

export type ResolvedFavorites = {
  creators: { id: string; name: string }[]
  series: { id: string; name: string; creatorName: string }[]
  works: { id: string; tbt_id: string; title: string; media_url: string | null }[]
}

/**
 * Resuelve las filas crudas de favorites (solo target_type/target_id) a
 * objetos mostrables — tres queries batched, una por tipo. La vista
 * Favorites (Build Spec 02, ÍTEM 4) los pinta como Creators · Series · Works.
 */
export async function resolveFavorites(rows: FavoriteRow[]): Promise<ResolvedFavorites> {
  const creatorIds = rows.filter((r) => r.target_type === 'creator').map((r) => r.target_id)
  const seriesIds = rows.filter((r) => r.target_type === 'series').map((r) => r.target_id)
  const workIds = rows.filter((r) => r.target_type === 'work').map((r) => r.target_id)

  const [creatorsRes, seriesRes, worksRes] = await Promise.all([
    creatorIds.length
      ? supabase.from('profiles').select('id, display_name, public_alias').in('id', creatorIds)
      : Promise.resolve({ data: [] }),
    seriesIds.length
      ? supabase
          .from('work_series')
          .select('id, name, creator:profiles!work_series_creator_id_fkey(display_name, public_alias)')
          .in('id', seriesIds)
      : Promise.resolve({ data: [] }),
    workIds.length
      ? supabase.from('works').select('id, tbt_id, title, media_url').in('id', workIds)
      : Promise.resolve({ data: [] }),
  ])

  const creators = (creatorsRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.public_alias || c.display_name || 'Unknown',
  }))
  const series = (seriesRes.data ?? []).map((s: any) => {
    const creator = Array.isArray(s.creator) ? s.creator[0] : s.creator
    return { id: s.id, name: s.name, creatorName: creator?.public_alias || creator?.display_name || 'Unknown' }
  })
  const works = (worksRes.data ?? []).map((w: any) => ({
    id: w.id,
    tbt_id: w.tbt_id,
    title: w.title,
    media_url: w.media_url,
  }))

  return { creators, series, works }
}
