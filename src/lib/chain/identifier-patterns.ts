/**
 * Lo que identifica a una persona y no puede llegar a Arweave — Item 10.
 *
 * Un solo sitio para los patrones, sin dependencias de Node, para que Brew
 * (navegador) y `assertNoIdentifiers` (servidor, antes de subir) digan lo mismo.
 * Si Brew aceptara un enlace que la publicacion rechaza, el registro fallaria
 * despues del pago (Chains 01, Stage 1.4).
 */

/** Un UUID, en cualquier caja. */
export const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i

/** Un telefono en formato internacional: al menos 8 digitos tras el mas. */
export const PHONE_RE = /\+\d[\d\s().-]{7,}/

/**
 * Un par de coordenadas en grados decimales.
 *
 * El spec las marca «Never»: `context_snapshots` las guarda y ahi se quedan.
 * En cadena va la ciudad y el pais, que son buena procedencia y no señalan una
 * casa. Esto no busca en una clave llamada `lat` —para eso ya esta la lista de
 * `records.ts`— sino un par suelto dentro de un texto libre, que es por donde
 * se colaria: el resumen del contexto lo escribe un modelo.
 *
 * Exige decimales en ambos numeros para no confundirse con «12, 40» o con un
 * rango de años.
 */
export const COORDS_RE = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/

export type IdentifierKind = 'uuid' | 'email' | 'phone' | 'coordinates'

/** El primer identificador que aparece en el texto, o null. */
export function identifierIn(text: string): IdentifierKind | null {
  if (UUID_RE.test(text)) return 'uuid'
  if (EMAIL_RE.test(text)) return 'email'
  if (PHONE_RE.test(text)) return 'phone'
  if (COORDS_RE.test(text)) return 'coordinates'
  return null
}

/**
 * Lo que impide publicar un enlace de activo, o null.
 *
 * Mira el enlace tal cual y tambien decodificado: `user%40example.com` es un
 * correo aunque el patron no vea la arroba. Brew es mas estricto que la
 * publicacion en ese punto, nunca menos.
 */
export function linkIdentifierProblem(link: string): IdentifierKind | null {
  const raw = identifierIn(link)
  if (raw) return raw
  try {
    return identifierIn(decodeURIComponent(link))
  } catch {
    return null
  }
}
