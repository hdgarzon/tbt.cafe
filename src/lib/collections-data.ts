import { supabase } from '@/lib/supabase'

/**
 * Capa de datos de las tres vistas personales — Creations / Collections /
 * Favorites (Build Spec 02, Ítem 4). Un patrón de pestañas unificado:
 * Creators · Series · Works (Collections, Favorites) o Series · Works ·
 * Featured (Creations, donde el creador ya se sabe: es el usuario).
 *
 * Creators y Series en Collections/Favorites se DERIVAN de las obras
 * poseídas/favoritas en el cliente — no hay una tabla de "creadores
 * seguidos". Esto es honesto sobre propiedad parcial: si solo tienes una
 * obra de un creador, ese creador aparece con esa única obra, no con su
 * catálogo completo.
 */

export type CollectionWork = {
  id: string
  tbt_id: string
  title: string
  media_url: string | null
  series_id: string | null
  is_featured: boolean
  creator_id: string
  creator_name: string
  series_name: string | null
}

type RawWorkRow = {
  id: string
  tbt_id: string
  title: string
  media_url: string | null
  series_id: string | null
  is_featured: boolean
  creator_id: string
  creator: { display_name: string | null; public_alias: string | null } | { display_name: string | null; public_alias: string | null }[] | null
  series: { name: string } | { name: string }[] | null
}

function normalize(rows: RawWorkRow[]): CollectionWork[] {
  return rows.map((w) => {
    const creator = Array.isArray(w.creator) ? w.creator[0] : w.creator
    const series = Array.isArray(w.series) ? w.series[0] : w.series
    return {
      id: w.id,
      tbt_id: w.tbt_id,
      title: w.title,
      media_url: w.media_url,
      series_id: w.series_id,
      is_featured: w.is_featured,
      creator_id: w.creator_id,
      creator_name: creator?.public_alias || creator?.display_name || 'Unknown',
      series_name: series?.name ?? null,
    }
  })
}

const SELECT =
  'id, tbt_id, title, media_url, series_id, is_featured, creator_id, creator:profiles!works_creator_id_fkey(display_name, public_alias), series:work_series(name)'

/** Obras que el usuario registró (es el creador) — incluye todo lo publicado/certificado propio. */
export async function fetchCreations(userId: string): Promise<CollectionWork[]> {
  const { data } = await supabase
    .from('works')
    .select(SELECT)
    .eq('creator_id', userId)
    .eq('status', 'certified')
    .order('created_at', { ascending: false })
  return normalize((data ?? []) as unknown as RawWorkRow[])
}

/** Obras que el usuario posee pero no creó — lo que compró o le transfirieron. */
export async function fetchCollections(userId: string): Promise<CollectionWork[]> {
  const { data } = await supabase
    .from('works')
    .select(SELECT)
    .eq('current_owner_id', userId)
    .neq('creator_id', userId)
    .order('created_at', { ascending: false })
  return normalize((data ?? []) as unknown as RawWorkRow[])
}

export type DerivedGroup = { id: string; name: string; count: number }

/** Agrupa un conjunto de obras por creador — para la pestaña Creators derivada. */
export function deriveCreators(works: CollectionWork[]): DerivedGroup[] {
  const byId = new Map<string, DerivedGroup>()
  for (const w of works) {
    const existing = byId.get(w.creator_id)
    if (existing) existing.count += 1
    else byId.set(w.creator_id, { id: w.creator_id, name: w.creator_name, count: 1 })
  }
  return Array.from(byId.values())
}

/** Agrupa un conjunto de obras por serie — para la pestaña Series derivada. Obras sin serie quedan fuera. */
export function deriveSeries(works: CollectionWork[]): DerivedGroup[] {
  const byId = new Map<string, DerivedGroup>()
  for (const w of works) {
    if (!w.series_id) continue
    const existing = byId.get(w.series_id)
    if (existing) existing.count += 1
    else byId.set(w.series_id, { id: w.series_id, name: w.series_name ?? '—', count: 1 })
  }
  return Array.from(byId.values())
}

/** Solo las obras marcadas como destacadas — para la pestaña Featured de Creations. */
export function onlyFeatured(works: CollectionWork[]): CollectionWork[] {
  return works.filter((w) => w.is_featured)
}

/**
 * Totales REALES por creador/serie — para mostrar honestamente la propiedad
 * parcial en Collections ("2 of 3 works held"), Build Spec 02, ÍTEM 4. Sin
 * esto, un creador derivado de las obras poseídas parecería tener solo las
 * que el usuario tiene, en vez de su catálogo completo.
 */
export async function fetchOwnershipTotals(
  creatorIds: string[],
  seriesIds: string[]
): Promise<{ creatorTotals: Map<string, number>; seriesTotals: Map<string, number> }> {
  const creatorTotals = new Map<string, number>()
  const seriesTotals = new Map<string, number>()

  if (creatorIds.length) {
    const { data } = await supabase
      .from('works')
      .select('creator_id')
      .in('creator_id', creatorIds)
      .eq('is_published', true)
      .eq('status', 'certified')
    for (const w of data ?? []) creatorTotals.set(w.creator_id, (creatorTotals.get(w.creator_id) ?? 0) + 1)
  }

  if (seriesIds.length) {
    const { data } = await supabase
      .from('works')
      .select('series_id')
      .in('series_id', seriesIds)
      .eq('is_published', true)
      .eq('status', 'certified')
    for (const w of data ?? []) {
      if (w.series_id) seriesTotals.set(w.series_id, (seriesTotals.get(w.series_id) ?? 0) + 1)
    }
  }

  return { creatorTotals, seriesTotals }
}
