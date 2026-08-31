/**
 * Quitar los metadatos de una imagen antes de publicarla.
 *
 * Chain Spec 01, Item 10. El aviso del spec es categorico:
 *
 *   Arweave no se puede borrar. Por nadie. Nunca. Si un telefono, un correo,
 *   el nombre legal de un comprador o una COORDENADA PRECISA llegan alli, ese
 *   dato es publico de forma permanente.
 *
 * Y la tabla del mismo item marca las coordenadas como «Never».
 *
 * POR QUE HACE FALTA ESTO Y NO BASTA CON `assertNoIdentifiers`
 *
 * Aquella guarda mira el JSON del registro. Una imagen no es JSON: un JPEG
 * salido de un telefono lleva un segmento APP1 con EXIF, y ahi dentro va
 * GPSLatitude, GPSLongitude, el numero de serie de la camara y muchas veces el
 * nombre del autor. Nada de eso aparece en el registro y todo eso viajaria
 * dentro del archivo.
 *
 * `normalizeImage` no lo quita: devuelve el archivo INTACTO cuando ya es PNG o
 * JPEG, que es el caso de casi toda foto de una obra. Solo reescribe —y de paso
 * borra los metadatos -- cuando el formato no era seguro.
 *
 * SIN RECOMPRIMIR
 *
 * Se recorren los segmentos y se copian los que quedan, byte a byte. Los datos
 * de la imagen no se tocan: la obra publicada tiene exactamente los pixeles que
 * tenia. Recomprimir habria sido menos codigo y mas perdida, y aqui lo que se
 * publica es permanente.
 *
 * FALLA CERRADO
 *
 * Un formato que no se sabe recorrer LANZA en vez de dejar pasar los bytes. No
 * poder auditar lo que se publica es exactamente el caso en que no hay que
 * publicar.
 */

export type StrippedImage = {
  bytes: Uint8Array
  mediaType: 'image/jpeg' | 'image/png'
  /** Cuantos bytes de metadatos se quedaron fuera. Para el registro del log. */
  removed: number
}

const JPEG_SOI = [0xff, 0xd8, 0xff]
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const startsWith = (b: Uint8Array, sig: number[]): boolean =>
  b.length >= sig.length && sig.every((v, i) => b[i] === v)

/** El tipo se decide por los bytes, nunca por la extension ni por la cabecera. */
export function sniffImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (startsWith(bytes, JPEG_SOI)) return 'image/jpeg'
  if (startsWith(bytes, PNG_SIG)) return 'image/png'
  return null
}

const ascii = (b: Uint8Array, at: number, s: string): boolean => {
  if (at + s.length > b.length) return false
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false
  return true
}

/**
 * Que segmentos de un JPEG sobreviven.
 *
 * APP0 solo si de verdad es JFIF —la cabecera de densidad que esperan los
 * decodificadores— y APP2 solo si de verdad es un perfil ICC, que es color y no
 * identifica a nadie. APP2 tambien puede llevar MPF, que EMBEBE UNA SEGUNDA
 * IMAGEN completa: se comprueba el contenido, no el numero de marcador.
 *
 * Fuera: APP1 (EXIF y XMP), APP13 (IPTC de Photoshop: autor, copyright, lugar),
 * APP14, los demas APPn, y COM.
 */
function keepJpegSegment(marker: number, payload: Uint8Array): boolean {
  if (marker === 0xe0) return ascii(payload, 0, 'JFIF\0') || ascii(payload, 0, 'JFXX\0')
  if (marker === 0xe2) return ascii(payload, 0, 'ICC_PROFILE\0')
  if (marker >= 0xe1 && marker <= 0xef) return false // el resto de los APPn
  if (marker === 0xfe) return false                  // COM
  return true                                        // estructura: SOF, DHT, DQT, DRI...
}

/**
 * Donde acaban los datos comprimidos y empieza el siguiente marcador.
 *
 * Dentro del flujo un 0xFF real va escapado como FF 00, y los marcadores de
 * reinicio FFD0-FFD7 son parte del flujo. Cualquier otro FFxx lo termina.
 *
 * Hace falta recorrerlo —en vez de copiar hasta el final— porque despues del
 * EOI muchas camaras y telefonos ANEXAN cosas: una segunda imagen MPF, un mapa
 * de profundidad, otro bloque de metadatos. Copiar «lo que queda» los subiria
 * enteros a un almacen permanente.
 */
function endOfEntropy(b: Uint8Array, from: number): number {
  let j = from
  while (j < b.length - 1) {
    if (b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7)) return j
    j++
  }
  return b.length
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)] // SOI
  let i = 2

  while (i < b.length - 1) {
    if (b[i] !== 0xff) throw new Error('strip: JPEG mal formado — se esperaba un marcador.')

    // Un marcador puede venir precedido de bytes de relleno 0xFF.
    let m = b[i + 1]
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1] }

    // EOI: la imagen termina aqui. Lo que venga despues no es imagen.
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); return concat(out) }

    // Marcadores sin carga.
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue }

    if (i + 4 > b.length) throw new Error('strip: JPEG truncado en la longitud de un segmento.')
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2 || i + 2 + len > b.length) throw new Error('strip: longitud de segmento JPEG invalida.')

    const payload = b.subarray(i + 4, i + 2 + len)
    if (keepJpegSegment(m, payload)) out.push(b.subarray(i, i + 2 + len))
    i += 2 + len

    // Tras un SOS vienen los datos comprimidos, que no llevan longitud. Un JPEG
    // progresivo trae varios, asi que se sigue recorriendo en vez de rendirse.
    if (m === 0xda) {
      const end = endOfEntropy(b, i)
      out.push(b.subarray(i, end))
      i = end
    }
  }

  throw new Error('strip: el JPEG termino sin marca de fin.')
}

/**
 * Que trozos de un PNG sobreviven.
 *
 * Se conserva la estructura y todo lo que afecta a como se ve: paleta,
 * transparencia, gamma, perfil de color, resolucion fisica. Y los trozos de
 * APNG, porque quitarlos convertiria una animacion en una foto fija sin decirlo.
 *
 * Fuera: tEXt, zTXt, iTXt (donde vive XMP), eXIf y tIME.
 */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND',
  'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'hIST',
  'acTL', 'fcTL', 'fdAT',
])

function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8

  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])
    const end = i + 12 + len
    if (end > b.length) throw new Error('strip: trozo PNG truncado.')

    if (PNG_KEEP.has(type)) {
      out.push(b.subarray(i, end))
    } else if (type[0] === type[0].toUpperCase()) {
      // Un trozo CRITICO desconocido no se puede tirar: el formato obliga al
      // decodificador a rendirse ante el, y publicar una imagen que quiza no
      // abra es peor que no publicarla.
      throw new Error(`strip: trozo PNG critico desconocido '${type}'.`)
    }

    i = end
    if (type === 'IEND') break
  }

  return concat(out)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/**
 * La orientación que el EXIF pedía, antes de que se le quite.
 *
 * Un teléfono no rota los píxeles: guarda el sensor tal cual —4032x3024 siempre—
 * y anota en `Orientation` cómo hay que girarlo al mostrarlo. Quitar el EXIF se
 * lleva esa etiqueta por delante, y una foto vertical pasa a verse tumbada.
 *
 * Pasó de verdad: la primera registración con una foto de telefono quedo con la
 * obra de lado en la pagina. La miniatura salio derecha de casualidad, porque el
 * lienzo la genera desde el archivo ORIGINAL, cuando la etiqueta todavia existe.
 *
 * Devuelve 1 —«tal cual»— cuando no hay etiqueta o no se puede leer. Quien llame
 * decide qué hacer; esto solo lee.
 */
export function jpegOrientation(b: Uint8Array): number {
  if (sniffImageType(b) !== 'image/jpeg') return 1

  let i = 2
  while (i < b.length - 1 && b[i] === 0xff) {
    const m = b[i + 1]
    if (m === 0xda || m === 0xd9) break
    if (i + 4 > b.length) break
    const len = (b[i + 2] << 8) | b[i + 3]
    const payload = b.subarray(i + 4, i + 2 + len)

    if (m === 0xe1 && ascii(payload, 0, 'Exif\0\0')) {
      const tiff = payload.subarray(6)
      if (tiff.length < 8) return 1

      // 'II' little-endian, 'MM' big-endian. Lo dice el propio bloque.
      const le = tiff[0] === 0x49 && tiff[1] === 0x49
      const u16 = (at: number) => (le ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1])
      const u32 = (at: number) =>
        le
          ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16) | (tiff[at + 3] << 24)) >>> 0
          : ((tiff[at] << 24) | (tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]) >>> 0

      if (u16(2) !== 0x2a) return 1
      const ifd = u32(4)
      if (ifd + 2 > tiff.length) return 1

      const count = u16(ifd)
      for (let e = 0; e < count; e++) {
        const at = ifd + 2 + e * 12
        if (at + 12 > tiff.length) break
        if (u16(at) === 0x0112) {
          const value = u16(at + 8)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }

    i += 2 + len
  }
  return 1
}

/**
 * Devuelve la imagen sin un solo metadato, o lanza.
 *
 * Es idempotente: pasar dos veces da el mismo resultado, asi que se puede
 * llamar en el navegador al subir y otra vez en el servidor al publicar sin
 * degradar nada. La segunda llamada es la que importa — es la que esta pegada
 * a lo permanente.
 */
export function stripMetadata(input: Uint8Array): StrippedImage {
  const mediaType = sniffImageType(input)
  if (!mediaType) {
    throw new Error('strip: solo se sabe recorrer JPEG y PNG. Lo que no se puede auditar no se publica.')
  }

  const bytes = mediaType === 'image/jpeg' ? stripJpeg(input) : stripPng(input)
  return { bytes, mediaType, removed: input.length - bytes.length }
}
