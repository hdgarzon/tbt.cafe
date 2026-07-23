/**
 * Resolución de key ↔ handle para /creator/[seg] — Build Spec 01, ÍTEM 2.
 *
 * Modelo:
 *   - La KEY es el identificador permanente, único y auto-asignado (p.ej. a7f3k9).
 *     Es la canónica bajo el capó, SIEMPRE.
 *   - El HANDLE es un nombre vanity comprado (p.ej. picasso), capa premium que
 *     resuelve a la key. Soltar el handle nunca rompe enlaces: vuelve a la key.
 *
 * Los creadores viven bajo /creator/ para que nunca colisionen con palabras
 * raíz reservadas (work, settings, brew, roast, grind).
 */

export type CreatorResolution = {
  /** Identificador canónico permanente. */
  key: string
  /** Handle vanity, si el segmento resolvió a uno. */
  handle: string | null
  /** true si el segmento de la URL era un handle y no la key. */
  isHandle: boolean
}

/**
 * Datos de simulación del prototipo (Master Handoff §4.1).
 * Sustituir por una consulta a Supabase al integrar.
 * Picasso demuestra el comportamiento handle comprado + colección renombrada.
 */
export const SIMULATED_CREATORS: ReadonlyArray<{
  name: string
  key: string
  handle: string | null
  collection: string
}> = [
  { name: 'Jean-Michel Basquiat', key: 'a7f3k9', handle: null, collection: 'Collection 1' },
  { name: 'Pablo Picasso', key: 'b2m8x1', handle: 'picasso', collection: 'Blue Period' },
  { name: 'Claude Monet', key: 'c5q4t7', handle: 'monet', collection: 'Collection 1' },
  { name: 'Fernando Botero', key: 'd9w6r2', handle: null, collection: 'Collection 1' },
  { name: 'Marc Chagall', key: 'e3n7v5', handle: null, collection: 'Collection 1' },
]

/**
 * Resuelve un segmento de URL a su creador.
 * Si coincide con un handle comprado, devuelve la key correspondiente;
 * en caso contrario, trata el segmento como key.
 */
export function resolveCreatorSeg(seg: string): CreatorResolution {
  const byHandle = SIMULATED_CREATORS.find(
    (c) => c.handle !== null && c.handle.toLowerCase() === seg.toLowerCase()
  )
  if (byHandle) {
    return { key: byHandle.key, handle: byHandle.handle, isHandle: true }
  }

  const byKey = SIMULATED_CREATORS.find(
    (c) => c.key.toLowerCase() === seg.toLowerCase()
  )
  return { key: seg, handle: byKey?.handle ?? null, isHandle: false }
}

/** Slug de colección a partir de su nombre (el slug sigue al nombre al renombrar). */
export const toCollectionSlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
