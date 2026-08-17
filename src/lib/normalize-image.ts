/**
 * Normaliza una imagen a PNG o JPEG antes de subirla.
 *
 * Existe por dos motivos que apuntan al mismo sitio:
 *
 *  - Spec 05 §3.2 excluye WebP y AVIF de las previsualizaciones sociales porque
 *    varios rastreadores todavía los manejan mal.
 *  - Nuestro propio compositor de previsualizaciones tampoco los decodifica: una
 *    obra en WebP salía compartida sin imagen, que es justo lo contrario de para
 *    lo que existe la previsualización.
 *
 * Se convierte al SUBIR y no al previsualizar, porque el archivo se guarda una
 * vez y se lee muchas: arreglarlo aguas arriba deja de ser un parche en cada
 * consumidor.
 */

/** Formatos que aguantan todo el camino: navegador, rastreador y compositor. */
const SAFE = new Set(['image/png', 'image/jpeg'])

/** Por encima de esto se reescala: 4096 es de sobra para un certificado. */
const MAX_EDGE = 4096

/**
 * Devuelve el archivo tal cual si ya es seguro, o una conversión si no.
 *
 * Si la conversión falla —un códec que el navegador no abre, un canvas
 * bloqueado— devuelve el original: subir algo raro es mejor que no dejar
 * registrar la obra. El coste sería una previsualización pobre, no un fallo.
 */
export async function normalizeImage(file: File): Promise<File> {
  if (SAFE.has(file.type)) return file

  try {
    const bitmap = await createImageBitmap(file)

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    // Fondo blanco antes de dibujar: un PNG con transparencia convertido a JPEG
    // pinta el alfa de negro, y una obra sobre negro no es la obra.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    )
    if (!blob) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'work'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
