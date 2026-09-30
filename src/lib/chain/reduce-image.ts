/**
 * El techo de lo que se publica — Chains 01, Stage 5.4.
 *
 * Cuando la imagen limpia pasa de 8 MB se publica una copia JPEG de alta
 * calidad por debajo del techo, `image_kind: reduced`. Nunca en silencio: la
 * nota bajo la eleccion lo dice. Y nunca nada, ni el original sobredimensionado.
 *
 * Se genera en el navegador al subir, junto a la miniatura, para que el
 * servidor no recodifique nunca. El codificador se inyecta: aqui solo vive la
 * regla de los pasos, que asi se puede probar sin canvas.
 */

export const PUBLISH_CEILING_BYTES = 8 * 1024 * 1024
export const REDUCE_QUALITY = 0.9

/** Fracciones del lado largo que se prueban, de mayor a menor. */
const STEPS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1]

/**
 * Null si `size` ya cabe: se publica el original limpio.
 * Si no, la primera copia bajo el techo, bajando el lado largo por pasos.
 * Lanza si ninguna cabe o el codificador no pudo: mejor que la obra se
 * registre sin imagen publicada que publicar algo que nadie vio.
 */
export async function reduceUnderCeiling<T extends { size: number }>(
  size: number,
  longEdge: number,
  encodeAt: (edge: number) => Promise<T | null>
): Promise<T | null> {
  if (size <= PUBLISH_CEILING_BYTES) return null
  for (let i = 0; i < STEPS.length; i++) {
    const edge = Math.round(longEdge * STEPS[i])
    if (edge < 1) break
    const out = await encodeAt(edge)
    if (out && out.size < PUBLISH_CEILING_BYTES) return out
  }
  throw new Error('image: no reduced copy fits under the ceiling.')
}
