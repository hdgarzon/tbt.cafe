import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Salud del indice de originalidad — Update Package 01, N10 (c).
 *
 * "Una consulta contra el sistema que ya tenemos" — la 049 puso `image_vectors`
 * al lado de `works` en Supabase, y con eso comparar los dos conteos deja de
 * ser una llamada cruzada. Una obra certificada con media_url y sin fila en
 * `image_vectors` es un scan que no ha corrido. Un scan que no ha corrido no
 * es un scan limpio — es la razon original de que este esfuerzo empezara.
 *
 * ALERTA: hoy el operador ve la divergencia en la vista de observabilidad. El
 * ticket automatico cuando el conteo diverge llega con Work Order 02 y el
 * scheduler (Supabase Cron). El observador humano es suficiente por ahora
 * porque las 49 obras de test se van al lanzamiento, y en produccion cada
 * indexado abre su propio ticket cuando falla individualmente.
 */

export type ImageIndexHealth = {
  certifiedWithMedia: number
  indexed: number
  divergent: boolean
  /** Los primeros work_id certificados que no estan en image_vectors. Corta a 20 para no llenar el panel. */
  missing: string[]
}

const MISSING_LIST_LIMIT = 20

export async function getImageIndexHealth(admin: SupabaseClient): Promise<ImageIndexHealth> {
  const [certified, indexed, missingRows] = await Promise.all([
    admin
      .from('works')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'certified')
      .not('media_url', 'is', null),
    admin
      .from('image_vectors')
      .select('work_id', { count: 'exact', head: true }),
    // Los que faltan: obra certificada con media, sin fila en image_vectors.
    // Se hace en una segunda consulta porque el JOIN antinatural via PostgREST
    // (¡ausencia! en una tabla relacionada) es incomodo — mejor dos consultas
    // legibles que una preciosa e ilegible.
    admin
      .from('works')
      .select('id, image_vectors!left(work_id)')
      .eq('status', 'certified')
      .not('media_url', 'is', null)
      .is('image_vectors.work_id', null)
      .limit(MISSING_LIST_LIMIT),
  ])

  const certifiedCount = certified.count ?? 0
  const indexedCount = indexed.count ?? 0
  const missing = (missingRows.data ?? []).map((row) => row.id as string)

  return {
    certifiedWithMedia: certifiedCount,
    indexed: indexedCount,
    divergent: certifiedCount !== indexedCount,
    missing,
  }
}
