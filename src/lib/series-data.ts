import { supabase } from '@/lib/supabase'

/**
 * Capa de datos de Series (Build Spec 02, Decisión 1) — la agrupación real
 * de un creador sobre sus propias obras (migración 006). Reemplaza la idea
 * ficticia de "Collection 1" que nunca tuvo tabla propia.
 */

export type SeriesWithCount = {
  id: string
  name: string
  slug: string
  count: number
}

const toSlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Series de un creador con el conteo de obras publicadas/certificadas en cada una. */
export async function fetchCreatorSeries(creatorId: string): Promise<SeriesWithCount[]> {
  const { data: series } = await supabase
    .from('work_series')
    .select('id, name, slug')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: true })

  if (!series?.length) return []

  const { data: works } = await supabase
    .from('works')
    .select('series_id')
    .eq('creator_id', creatorId)
    .eq('is_published', true)
    .eq('status', 'certified')
    .not('series_id', 'is', null)

  const counts = new Map<string, number>()
  for (const w of works ?? []) {
    if (w.series_id) counts.set(w.series_id, (counts.get(w.series_id) ?? 0) + 1)
  }

  return series.map((s) => ({ ...s, count: counts.get(s.id) ?? 0 }))
}

/**
 * Auto "Series 1" — al certificar la primera obra de un creador, si no tiene
 * ninguna serie aún, crea una y devuelve su id para adjuntarla a la obra.
 * Llamar desde el flujo de brew/certify, nunca desde una migración.
 */
export async function ensureFirstSeries(creatorId: string, name = 'Series 1'): Promise<string | null> {
  const { data: existing } = await supabase
    .from('work_series')
    .select('id')
    .eq('creator_id', creatorId)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('work_series')
    .insert({ creator_id: creatorId, name, slug: toSlug(name) })
    .select('id')
    .single()
  if (error) return null
  return data.id
}

/** Renombra una serie propia — el slug sigue al nombre. */
export async function renameSeries(seriesId: string, name: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('work_series')
    .update({ name: name.trim(), slug: toSlug(name) })
    .eq('id', seriesId)
  return error ? { error: error.message } : {}
}
