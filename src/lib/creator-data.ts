import { supabase } from '@/lib/supabase'

/**
 * Datos reales de creadores/obras — reemplaza el catálogo de simulación
 * (SIMULATED_CREATORS en creator-routing.ts) que solo servía para probar la
 * fidelidad visual del prototipo. Estas funciones consultan el Supabase real
 * que comparte esta app con el backend de Forms (mismo proyecto, mismas
 * tablas `profiles`/`works`).
 *
 * IMPORTANTE: no existe una tabla `collections` en el backend real — "Collection
 * 1" era una idea del Master Handoff nunca implementada. Un creador es
 * simplemente su lista de obras publicadas; no hay agrupación adicional.
 *
 * Direccionamiento: el backend no tiene el sistema de "key permanente +
 * handle comprado" que describía el prototipo — el identificador real es el
 * UUID de `profiles.id`. Como fallback amigable, un `public_alias` exacto
 * (case-insensitive) también resuelve, para que /creator/panda funcione si
 * ese alias es único.
 */

export type PublicCreator = {
  id: string
  display_name: string | null
  public_alias: string | null
  avatar_url: string | null
}

export type PublicWork = {
  id: string
  tbt_id: string
  title: string
  media_url: string | null
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Resuelve un segmento de URL a un creador real: UUID exacto o alias público. */
export async function findCreatorBySeg(seg: string): Promise<PublicCreator | null> {
  const base = supabase.from('profiles').select('id, display_name, public_alias, avatar_url')
  const { data } = isUuid(seg)
    ? await base.eq('id', seg).maybeSingle()
    : await base.ilike('public_alias', seg).maybeSingle()
  return data
}

/** Obras publicadas y certificadas de un creador — lo único visible públicamente. */
export async function fetchCreatorWorks(creatorId: string): Promise<PublicWork[]> {
  const { data } = await supabase
    .from('works')
    .select('id, tbt_id, title, media_url')
    .eq('creator_id', creatorId)
    .eq('is_published', true)
    .eq('status', 'certified')
    .order('created_at', { ascending: false })
  return data ?? []
}

export type SearchHit = {
  kind: 'creator' | 'work'
  name: string
  meta: string
  href: string
}

/** Búsqueda en vivo sobre creadores y obras reales, publicados/certificados. */
export async function searchCatalog(query: string): Promise<SearchHit[]> {
  const q = query.trim().replace(/[,()]/g, '')
  if (!q) return []

  const [{ data: creators }, { data: works }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, public_alias')
      .eq('is_creator', true)
      .or(`display_name.ilike.%${q}%,public_alias.ilike.%${q}%`)
      .limit(8),
    supabase
      .from('works')
      .select('tbt_id, title, creator:profiles!works_creator_id_fkey(display_name, public_alias)')
      .eq('is_published', true)
      .eq('status', 'certified')
      .ilike('title', `%${q}%`)
      .limit(8),
  ])

  const creatorHits: SearchHit[] = (creators ?? []).map((c) => {
    const seg = c.public_alias || c.id
    return {
      kind: 'creator' as const,
      name: c.public_alias || c.display_name || 'Creator',
      meta: `/creator/${seg}`,
      href: `/creator/${seg}`,
    }
  })

  const workHits: SearchHit[] = (works ?? []).map((w) => {
    const creator = Array.isArray(w.creator) ? w.creator[0] : w.creator
    return {
      kind: 'work' as const,
      name: w.title,
      meta: creator?.public_alias || creator?.display_name || 'Unknown',
      href: `/work/${w.tbt_id}`,
    }
  })

  return [...creatorHits, ...workHits]
}
