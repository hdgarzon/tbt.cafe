import { readFileSync } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { stripMetadata, sniffImageType } from '../src/lib/chain/strip-metadata'
import { registrationRecord } from '../src/lib/chain/records'
import { canonicalize } from '../src/lib/chain/serialize'
import { assertNoIdentifiers } from '../src/lib/chain/pseudonym'
import { CHAIN_IMAGE_CHOICES, isChainImageChoice, MAX_PUBLISH_BYTES, assertPublishableSource } from '../src/lib/chain/publish-image'

/**
 * Lo que sube a Arweave no se puede retirar. Prueba primero.
 *
 * La imagen de una obra es el unico artefacto de la cadena que NO es texto que
 * nosotros escribimos: llega del telefono de alguien, con lo que el telefono le
 * haya metido dentro. Casi todo lo de aqui es una forma de preguntar lo mismo —
 * ¿de verdad sale solo lo que se ve?
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'no lanzó') } catch { ok(label, true) }
}

const bytes = (...parts: Array<number[] | Uint8Array | Buffer>): Uint8Array =>
  new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p as never))))

// ---------------------------------------------------------------- JPEG
//
// Sintetico y a proposito: aqui se prueba el RECORRIDO de los segmentos, y una
// obra real no puede vivir en el repositorio. Contra archivos de verdad se
// comprueba a mano — el recorrido llega intacto al final de un JPEG de 862 kB.

const seg = (marker: number, payload: string | number[]): Uint8Array => {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'latin1') : Buffer.from(payload)
  const len = body.length + 2
  return bytes([0xff, marker, len >> 8, len & 0xff], body)
}

const JFIF = seg(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0')
const EXIF_GPS = seg(0xe1, 'Exif\0\0MM\0*GPSLatitude 4.60971 GPSLongitude -74.08175 Artist Sara')
const XMP = seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>sara@example.com</x:xmpmeta>')
const ICC = seg(0xe2, 'ICC_PROFILE\0\x01\x01' + 'perfil de color'.padEnd(60, ' '))
const MPF = seg(0xe2, 'MPF\0' + 'una segunda imagen entera'.padEnd(60, ' '))
const IPTC = seg(0xed, 'Photoshop 3.0\0 By-line: Sara Alarcon  City: Medellin')
const COM = seg(0xfe, 'tomada en casa')
const DQT = seg(0xdb, new Array(66).fill(7))
const SOS = seg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
const ENTROPY = bytes([0x9a, 0xff, 0x00, 0x4c, 0xff, 0xd0, 0x11, 0x22])
const EOI = bytes([0xff, 0xd9])
const TRAILER = bytes(Buffer.from('APPENDED MPF SECOND IMAGE +573001234567', 'latin1'))

const dirtyJpeg = bytes([0xff, 0xd8], JFIF, EXIF_GPS, XMP, ICC, MPF, IPTC, COM, DQT, SOS, ENTROPY, EOI, TRAILER)
const cleanJpeg = bytes([0xff, 0xd8], JFIF, ICC, DQT, SOS, ENTROPY, EOI)

// ---- se reconoce por los bytes, no por la extensión
{
  ok('reconoce un JPEG', sniffImageType(dirtyJpeg) === 'image/jpeg')
  ok('no reconoce un WebP', sniffImageType(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])) === null)
}

// ---- nada de lo que identifica sobrevive
{
  const out = Buffer.from(stripMetadata(dirtyJpeg).bytes)
  ok('el EXIF con GPS no sale', !out.includes('GPSLatitude'))
  ok('el nombre del autor tampoco', !out.includes('Artist Sara'))
  ok('el XMP no sale', !out.includes('sara@example.com'))
  ok('el IPTC de Photoshop no sale', !out.includes('By-line'))
  ok('el comentario no sale', !out.includes('tomada en casa'))
  ok('lo anexado tras el EOI no sale', !out.includes('APPENDED'),
     'ahi es donde los teléfonos esconden una segunda imagen')
  ok('un APP2 que no es ICC no sale', !out.includes('una segunda imagen entera'),
     'se mira el contenido, no el número de marcador')
}

// ---- y lo que hace falta para verla sí
{
  const out = Buffer.from(stripMetadata(dirtyJpeg).bytes)
  ok('el JFIF se conserva', out.includes('JFIF'))
  ok('el perfil de color se conserva', out.includes('ICC_PROFILE'))
  ok('los datos comprimidos se conservan', out.includes(Buffer.from(ENTROPY)))
}

// ---- sin recomprimir: los píxeles son los mismos
{
  const a = stripMetadata(dirtyJpeg).bytes
  const b = stripMetadata(cleanJpeg).bytes
  ok('limpiar un sucio da el mismo archivo que limpiar el limpio',
     Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0)
  ok('idempotente', Buffer.compare(Buffer.from(stripMetadata(a).bytes), Buffer.from(a)) === 0,
     'se llama al subir y otra vez al publicar')
  ok('un archivo ya limpio no pierde un solo byte', stripMetadata(cleanJpeg).removed === 0)
  ok('cuenta lo que dejó fuera', stripMetadata(dirtyJpeg).removed > 0)
}

// ---- se recorre el flujo, no se copia lo que queda
{
  const withFill = bytes([0xff, 0xd8], JFIF, DQT, SOS, ENTROPY, [0xff, 0xff], EOI)
  ok('un relleno 0xFF antes del marcador no lo rompe', stripMetadata(withFill).bytes.length > 0)
  throws('un JPEG sin marca de fin lanza', () =>
    stripMetadata(bytes([0xff, 0xd8], JFIF, DQT, SOS, ENTROPY)))
}

// ---------------------------------------------------------------- PNG
//
// Este sí es real: se construye con zlib y sus CRC salen bien, así que lo que
// se prueba es un PNG que un decodificador abriría.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

const IHDR = Buffer.alloc(13)
IHDR.writeUInt32BE(1, 0)
IHDR.writeUInt32BE(1, 4)
IHDR[8] = 8   // profundidad
IHDR[9] = 2   // color RGB
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IDAT = deflateSync(Buffer.from([0x00, 0x2a, 0x2a, 0x2a]))

const keep = [chunk('IHDR', IHDR), chunk('sRGB', Buffer.from([0])), chunk('IDAT', IDAT), chunk('IEND', Buffer.alloc(0))]
const dirtyPng = new Uint8Array(Buffer.concat([
  PNG_SIG,
  chunk('IHDR', IHDR),
  chunk('tEXt', Buffer.from('Author\0Sara Alarcon', 'latin1')),
  chunk('sRGB', Buffer.from([0])),
  chunk('eXIf', Buffer.from('MM\0*GPSLatitude 4.60971', 'latin1')),
  chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0sara@example.com', 'latin1')),
  chunk('tIME', Buffer.from([0x07, 0xea, 1, 1, 0, 0, 0])),
  chunk('IDAT', IDAT),
  chunk('IEND', Buffer.alloc(0)),
]))

{
  const out = Buffer.from(stripMetadata(dirtyPng).bytes)
  ok('reconoce un PNG', stripMetadata(dirtyPng).mediaType === 'image/png')
  ok('el tEXt con el autor no sale', !out.includes('Sara Alarcon'))
  ok('el eXIf con GPS no sale', !out.includes('GPSLatitude'))
  ok('el iTXt con XMP no sale', !out.includes('sara@example.com'))
  ok('la marca de tiempo no sale', !out.includes(Buffer.from('tIME', 'latin1')))
  ok('el resultado es exactamente firma + los trozos que se conservan',
     Buffer.compare(out, Buffer.concat([PNG_SIG, ...keep])) === 0,
     'y con sus CRC intactos, porque se copian enteros')
}

// ---- falla cerrado
{
  const withChunk = (type: string) =>
    new Uint8Array(Buffer.concat([
      PNG_SIG, chunk('IHDR', IHDR), chunk(type, Buffer.from('secreto', 'latin1')),
      chunk('IDAT', IDAT), chunk('IEND', Buffer.alloc(0)),
    ]))

  ok('un trozo auxiliar desconocido se descarta en silencio',
     !Buffer.from(stripMetadata(withChunk('zZZz')).bytes).includes('secreto'),
     'minúscula inicial = auxiliar: el formato permite ignorarlo')
  throws('un trozo crítico desconocido lanza', () => stripMetadata(withChunk('ZzZz')))
  throws('un WebP lanza', () =>
    stripMetadata(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])))
  throws('un GIF lanza', () => stripMetadata(bytes(Buffer.from('GIF89a'))))
}

// ---------------------------------------------------------------- el registro

const HASH = 'sha256:' + 'a'.repeat(64)
const IMG_HASH = 'sha256:' + 'b'.repeat(64)
const AR = 'https://arweave.net/8Kf2QpX'

const base = {
  tbtId: 'TBT-2026-ABC123',
  sequence: 1,
  contentHash: HASH,
  creator: { name: 'Sara Alarcón', id: 'cr_8812', type: 'individual' as const },
  work: { title: 'Nocturno en Medellín', year: 2026, originality: 'original' as const },
  sealedAt: new Date(Date.UTC(2026, 7, 26, 14, 3, 22)),
}

// ---- la imagen es opcional y va entera o no va
{
  const sin = registrationRecord(base)
  ok('sin elección no hay claves de imagen',
     !('image' in sin) && !('image_hash' in sin) && !('image_kind' in sin))

  const con = registrationRecord({ ...base, image: { uri: AR, hash: IMG_HASH, kind: 'thumbnail' } })
  ok('con elección van las tres', con.image === AR && con.image_hash === IMG_HASH && con.image_kind === 'thumbnail')
  ok('el hash de la imagen NO es el del contenido', con.image_hash !== con.content_hash,
     'uno es lo publicado y el otro el archivo del creador')
}

// ---- lo que no puede pasar
{
  throws('una URI que no es https lanza', () =>
    registrationRecord({ ...base, image: { uri: 'ar://8Kf2', hash: IMG_HASH, kind: 'full' } }))
  throws('un hash que no es sha256 lanza', () =>
    registrationRecord({ ...base, image: { uri: AR, hash: 'deadbeef', kind: 'full' } }))
  throws('una clase desconocida lanza', () =>
    registrationRecord({ ...base, image: { uri: AR, hash: IMG_HASH, kind: 'original' as never } }))
}

// ---- la guarda del Item 10 sigue siendo la última puerta
{
  const con = registrationRecord({ ...base, image: { uri: AR, hash: IMG_HASH, kind: 'full' } })
  let threw = false
  try { assertNoIdentifiers(con) } catch { threw = true }
  ok('un registro con imagen de Arweave pasa la guarda', !threw)

  // La URL de origen lleva dentro el UUID del creador: works-media/<uuid>/...
  const supa = 'https://x.supabase.co/storage/v1/object/public/works-media/5b84cf07-6516-4873-bfdd-379805913c4d/1.jpg'
  throws('publicar la URL de origen en su lugar lanza', () =>
    assertNoIdentifiers(registrationRecord({ ...base, image: { uri: supa, hash: IMG_HASH, kind: 'full' } })))
}

// ---- serializa canónico
{
  const con = registrationRecord({ ...base, image: { uri: AR, hash: IMG_HASH, kind: 'thumbnail' } })
  const s = canonicalize(con)
  ok('las claves de imagen salen en orden de punto de código',
     s.indexOf('"image"') < s.indexOf('"image_hash"') && s.indexOf('"image_hash"') < s.indexOf('"image_kind"'))
  ok('la reserialización reproduce los mismos bytes', canonicalize(JSON.parse(s)) === s)
}

// ---- las tres opciones, y nada más
{
  ok('son exactamente tres', CHAIN_IMAGE_CHOICES.length === 3)
  ok('none está entre ellas', isChainImageChoice('none'))
  ok('cualquier otra cosa no', !isChainImageChoice('original') && !isChainImageChoice(''))
  ok('el techo de subida es finito', MAX_PUBLISH_BYTES > 0 && MAX_PUBLISH_BYTES <= 16 * 1024 * 1024)
}

// ---------------------------------------------------------------- el origen
//
// `chain_image_url` la escribe el navegador, y el servidor la lee y trae lo que
// haya al otro lado. Es la puerta por la que alguien haria que pidieramos una
// direccion interna y publicaramos la respuesta.

{
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qfflheep.supabase.co'
  const mine = 'https://qfflheep.supabase.co/storage/v1/object/public/works-media/abc/1.jpg'

  let threw = false
  try { assertPublishableSource(mine) } catch { threw = true }
  ok('nuestro propio almacén pasa', !threw)

  throws('otro dominio no', () =>
    assertPublishableSource('https://evil.example.com/works-media/1.jpg'))
  throws('http tampoco', () =>
    assertPublishableSource('http://qfflheep.supabase.co/storage/v1/object/public/works-media/a/1.jpg'))
  throws('otro bucket del mismo proyecto tampoco', () =>
    assertPublishableSource('https://qfflheep.supabase.co/storage/v1/object/public/avatars/1.jpg'))
  throws('una data: URL tampoco', () => assertPublishableSource('data:image/png;base64,iVBOR'))
  throws('el endpoint de metadatos de la nube menos', () =>
    assertPublishableSource('http://169.254.169.254/latest/meta-data/'))
  throws('un subdominio que solo lo parece tampoco', () =>
    assertPublishableSource('https://qfflheep.supabase.co.evil.com/storage/v1/object/public/works-media/1.jpg'))
}

// ---------------------------------------------------------------- el cableado
//
// Se afirma sobre CONSTRUCCIONES del código, nunca sobre la prosa: un comentario
// que explique por qué algo no se hace haría pasar una prueba que busca su nombre.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

{
  const route = read('src/app/api/complete-tbt/route.ts')
  ok('la imagen se publica antes que el registro',
     route.indexOf('publishWorkImage(') > 0 &&
     route.indexOf('publishWorkImage(') < route.indexOf('publishRecord('),
     'el registro la nombra: nombrar lo que no existe deja una URI permanente a un 404')
  ok('una copia ya subida se reutiliza en vez de republicarse',
     route.includes('workWithCreator.chain_image_uri &&'))
  ok('el fallo de la imagen no tumba el registro',
     route.includes("console.error('[chain] no se pudo publicar la imagen:'"))
  ok('el registro de imágenes también comprueba el origen antes de traerla',
     route.indexOf('assertPublishableSource(work.media_url)') > 0 &&
     route.indexOf('assertPublishableSource(work.media_url)') < route.indexOf('await fetch(work.media_url)'),
     'esa lectura ya existía y no lo hacía')
}

{
  const pub = read('src/lib/chain/publish-image.ts')
  ok('se limpia antes de subir',
     pub.indexOf('stripMetadata(') < pub.indexOf('uploadToArweave('))
  ok('el techo se comprueba sobre los bytes ya limpios',
     pub.includes('clean.bytes.length > MAX_PUBLISH_BYTES'))
  ok('el origen se comprueba antes de pedir nada',
     pub.indexOf('assertPublishableSource(opts.sourceUrl)') < pub.indexOf('await fetch(opts.sourceUrl)'))
}

{
  const brew = read('src/lib/brew-data.ts')
  ok('lo que se guarda en works-media también sale limpio',
     brew.includes('await stripped(await normalizeImage(file))'),
     'ese archivo se sirve público: el EXIF llegaría a cualquiera que lo descargue')
  ok('la miniatura solo se publica si de verdad se pudo hacer',
     brew.includes('if (thumb) chainImageUrl ='),
     'sin ella se publica menos, nunca la obra entera')
}

{
  const wizard = read('src/components/brew/BrewWizard.tsx')
  ok('una obra privada no propone publicar nada',
     wizard.includes("isPublished ? 'thumbnail' : 'none'"))
  ok('el control vive en el Sello', wizard.includes('t.brew.chainImageLabel'))
}

{
  const mig = read('supabase/migrations/036_chain_image.sql')
  ok('la columna nace en none', mig.includes("chain_image text not null default 'none'"),
     'una ruta que olvide el campo no puede publicar la obra de nadie')
  ok('y solo admite las tres', mig.includes("check (chain_image in ('none', 'thumbnail', 'full'))"))
}

console.log(bad === 0 ? '\nTodo en orden.' : `\n${bad} fallo(s).`)
process.exit(bad === 0 ? 0 : 1)
