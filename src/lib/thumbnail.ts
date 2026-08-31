/**
 * La reduccion que se publica cuando el creador elige miniatura.
 *
 * Chain Spec 01, Item 10: «thumbnail for legibility». Un registro sin imagen se
 * lee, pero no se reconoce; una miniatura basta para saber que obra es sin
 * publicar el archivo entero en un sitio del que no se puede retirar.
 *
 * Se genera EN EL NAVEGADOR, como `normalizeImage`, y por el mismo motivo: en
 * el servidor no hay con que redimensionar sin meter una dependencia nativa, y
 * los bytes ya estan aqui. De paso el lienzo repinta la imagen desde cero, asi
 * que ningun metadato del original sobrevive al viaje — aunque igualmente se
 * vuelva a limpiar antes de publicar.
 */

/** Suficiente para reconocer la obra en cualquier pantalla; lejos de ser el original. */
export const THUMB_MAX_EDGE = 1024

/**
 * Devuelve la miniatura, o `null` si el navegador no pudo hacerla.
 *
 * `null` no cae hacia atras a publicar la imagen completa. El creador eligio una
 * miniatura, y ante la duda lo que se publica es MENOS, no mas: sin ella la obra
 * se certifica igual y el registro sale sin imagen.
 */
export async function makeThumbnail(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file)

    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Fondo blanco antes de dibujar, igual que al normalizar: el alfa de un PNG
    // convertido a JPEG se pinta de negro, y una obra sobre negro no es la obra.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    )
    if (!blob) return null

    const base = file.name.replace(/\.[^.]+$/, '') || 'work'
    return new File([blob], `${base}-thumb.jpg`, { type: 'image/jpeg' })
  } catch {
    return null
  }
}
