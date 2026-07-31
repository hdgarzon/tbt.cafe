import { supabase } from '@/lib/supabase'

/**
 * Datos reales de creadores/obras — reemplaza el catálogo de simulación
 * (SIMULATED_CREATORS en creator-routing.ts) que solo servía para probar la
 * fidelidad visual del prototipo. Estas funciones consultan el Supabase real
 * que comparte esta app con el backend de Forms (mismo proyecto, mismas
 * tablas `profiles`/`works`).
 *
 * Build Spec 02, Decisión 1: "Series" ahora SÍ existe como tabla real
 * (`work_series`, migración 006) — reemplaza la idea de "Collection 1" del
 * Master Handoff, que nunca se implementó. fetchCreatorWorks incluye
 * series_id e is_featured para alimentar el filtro de Series y la pestaña
 * Featured de /creator/[seg].
 *
 * Direccionamiento: el backend no tiene el sistema de "key permanente +
 * handle comprado" que describía el prototipo (Decisión 2, explícitamente
 * fuera de alcance) — el identificador real es el UUID de `profiles.id`.
 * Como fallback amigable, un `public_alias` exacto (case-insensitive)
 * también resuelve, para que /creator/panda funcione si ese alias es único.
 */

export type PublicCreator = {
  id: string
  display_name: string | null
  public_alias: string | null
  avatar_url: string | null
  bio: string | null
  creator_type: string | null
  credentials: string | null
  social_linkedin: string | null
  social_website: string | null
  social_instagram: string | null
}

export type PublicWork = {
  id: string
  tbt_id: string
  title: string
  media_url: string | null
  series_id: string | null
  is_featured: boolean
  created_at: string
  availability: 'for_sale' | 'reserved' | 'not_for_sale'
  taking_offers: boolean
  initial_price: number | null
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Resuelve un segmento de URL a un creador real: UUID exacto o alias público. */
export async function findCreatorBySeg(seg: string): Promise<PublicCreator | null> {
  const base = supabase
    .from('profiles')
    .select(
      'id, display_name, public_alias, avatar_url, bio, creator_type, credentials, social_linkedin, social_website, social_instagram'
    )
  const { data } = isUuid(seg)
    ? await base.eq('id', seg).maybeSingle()
    : await base.ilike('public_alias', seg).maybeSingle()
  return data
}

/** Obras publicadas y certificadas de un creador — lo único visible públicamente. */
export async function fetchCreatorWorks(creatorId: string): Promise<PublicWork[]> {
  const { data } = await supabase
    .from('works')
    .select(
      'id, tbt_id, title, media_url, series_id, is_featured, created_at, commerce:work_commerce(availability, taking_offers, initial_price)'
    )
    .eq('creator_id', creatorId)
    .eq('is_published', true)
    .eq('status', 'certified')
    .order('created_at', { ascending: false })

  return (data ?? []).map((w) => {
    const commerce = Array.isArray(w.commerce) ? w.commerce[0] : w.commerce
    return {
      id: w.id,
      tbt_id: w.tbt_id,
      title: w.title,
      media_url: w.media_url,
      series_id: w.series_id,
      is_featured: w.is_featured,
      created_at: w.created_at,
      availability: commerce?.availability ?? 'not_for_sale',
      taking_offers: commerce?.taking_offers ?? false,
      initial_price: commerce?.initial_price ?? null,
    }
  })
}

export type SearchHit = {
  kind: 'creator' | 'work'
  name: string
  href: string
  avatarUrl: string | null
  /** Monogram hue (0-359), stable per creator — used when there's no avatar. */
  hue: number
  /** For a work: its series/collection name, if any. */
  seriesName?: string | null
  /** For a work: its creator's display name. */
  creatorName?: string
}

/** Hash a string to a stable 0-359 hue, matching tbt-espresso.html's hueFor(). */
function hueFrom(key: string): number {
  let h = 7
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** Búsqueda en vivo sobre creadores y obras reales, publicados/certificados. */
export async function searchCatalog(query: string): Promise<SearchHit[]> {
  const q = query.trim().replace(/[,()]/g, '')
  if (!q) return []

  const [{ data: creators }, { data: works }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, public_alias, avatar_url')
      .eq('is_creator', true)
      .or(`display_name.ilike.%${q}%,public_alias.ilike.%${q}%`)
      .limit(8),
    supabase
      .from('works')
      .select(
        'tbt_id, title, media_url, series:work_series(name), creator:profiles!works_creator_id_fkey(display_name, public_alias, avatar_url)'
      )
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
      href: `/creator/${seg}`,
      avatarUrl: c.avatar_url,
      hue: hueFrom(c.id),
    }
  })

  const workHits: SearchHit[] = (works ?? []).map((w) => {
    const creator = Array.isArray(w.creator) ? w.creator[0] : w.creator
    const series = Array.isArray(w.series) ? w.series[0] : w.series
    return {
      kind: 'work' as const,
      name: w.title,
      href: `/work/${w.tbt_id}`,
      avatarUrl: w.media_url,
      hue: hueFrom(w.tbt_id),
      seriesName: series?.name ?? null,
      creatorName: creator?.public_alias || creator?.display_name || undefined,
    }
  })

  return [...creatorHits, ...workHits]
}
