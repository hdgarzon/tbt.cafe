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
export type SimulatedCreator = {
  name: string
  key: string
  handle: string | null
  collection: string
  works: readonly string[]
}

export const SIMULATED_CREATORS: readonly SimulatedCreator[] = [
  {
    name: 'Jean-Michel Basquiat',
    key: 'a7f3k9',
    handle: null,
    collection: 'Collection 1',
    works: ['Untitled (Skull)', 'Dustheads', 'Irony of Negro Policeman', 'Hollywood Africans'],
  },
  {
    name: 'Pablo Picasso',
    key: 'b2m8x1',
    handle: 'picasso',
    collection: 'Blue Period',
    works: ['Guernica', 'Les Demoiselles d’Avignon', 'The Old Guitarist', 'Girl before a Mirror'],
  },
  {
    name: 'Claude Monet',
    key: 'c5q4t7',
    handle: 'monet',
    collection: 'Collection 1',
    works: ['Water Lilies', 'Impression, Sunrise', 'Woman with a Parasol', 'Rouen Cathedral'],
  },
  {
    name: 'Fernando Botero',
    key: 'd9w6r2',
    handle: null,
    collection: 'Collection 1',
    works: ['Mona Lisa, Age Twelve', 'The Musicians', 'Dancers'],
  },
  {
    name: 'Marc Chagall',
    key: 'e3n7v5',
    handle: null,
    collection: 'Collection 1',
    works: ['I and the Village', 'The Birthday', 'White Crucifixion'],
  },
]

/**
 * El segmento con el que se direcciona a un creador: el handle comprado si lo
 * tiene, y si no la key permanente.
 */
export const creatorSeg = (c: SimulatedCreator) => c.handle ?? c.key

/**
 * TBT-ID determinista de 6 dígitos por obra — sustituto del ID real de cadena.
 * Determinista para que las URLs de la demo sean estables entre recargas.
 */
export const tbtIdFor = (c: SimulatedCreator, index: number) =>
  String(
    100000 + c.key.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) * 7 + index * 137
  ).slice(-6)

export type SimulatedPiece = {
  title: string
  creator: SimulatedCreator
  tbtId: string
}

/** Catálogo aplanado de obras, cada una con su creador y TBT-ID. */
export const SIMULATED_PIECES: readonly SimulatedPiece[] = SIMULATED_CREATORS.flatMap((c) =>
  c.works.map((title, i) => ({ title, creator: c, tbtId: tbtIdFor(c, i) }))
)

/** Colecciones — una por creador en estos datos de simulación. */
export const SIMULATED_COLLECTIONS = SIMULATED_CREATORS.map((c) => ({
  name: c.collection,
  creator: c,
  count: c.works.length,
}))

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
