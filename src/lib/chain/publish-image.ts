/**
 * La obra en el registro permanente — Chain Spec 01, Item 10.
 *
 * El spec deja este punto abierto y con una recomendacion: «Hash always;
 * thumbnail for legibility; full resolution only where the creator elects it.
 * Needs a control in the brew flow.»
 *
 * LO QUE SUBE NO ES EL ARCHIVO DE ORIGEN, Y NO PUEDE SERLO
 *
 * Un JPEG salido de un telefono lleva EXIF, y el EXIF lleva coordenadas. El
 * Item 10 las marca «Never» y avisa de que Arweave no se borra. Asi que lo que
 * se publica pasa siempre por `stripMetadata`, y en cuanto se le quita un byte
 * ya no es el archivo que el creador subio.
 *
 * De ahi la separacion que el registro mantiene:
 *
 *   content_hash   el archivo TAL COMO SE SUBIO. Solo lo tiene el creador, y es
 *                  contra lo que se verifica el certificado.
 *   image_hash     los bytes que de verdad estan publicados. Cualquiera puede
 *                  descargarlos y comprobarlo, sin tbt.cafe y para siempre.
 *
 * Confundirlos seria decir que la copia publica es el original. No lo es, y el
 * registro no debe insinuarlo.
 */
import { createHash } from 'crypto'
import { toMetaplexFile } from '@metaplex-foundation/js'
import { stripMetadata } from './strip-metadata'
import { uploadToArweave } from './arweave'

/** Lo que un creador puede elegir. `none` es lo que vale cuando nadie eligio. */
export const CHAIN_IMAGE_CHOICES = ['none', 'thumbnail', 'full'] as const
export type ChainImageChoice = (typeof CHAIN_IMAGE_CHOICES)[number]
export type ChainImageKind = Exclude<ChainImageChoice, 'none'>

export const isChainImageChoice = (v: unknown): v is ChainImageChoice =>
  typeof v === 'string' && (CHAIN_IMAGE_CHOICES as readonly string[]).includes(v)

/**
 * El techo de lo que se sube.
 *
 * En mainnet cada byte cuesta y se paga desde la cartera pagadora del proyecto.
 * Un archivo que se sale de esto no se publica en silencio ni a medias: se
 * anota y la obra se certifica igual. Es un limite, no un recorte — reescalar
 * por nuestra cuenta publicaria algo que el creador no eligio.
 */
export const MAX_PUBLISH_BYTES = 8 * 1024 * 1024

/** Etiquetas de la subida, en un sitio para que la prueba no diverja. */
export const IMAGE_TAGS = {
  app: 'App-Name',
  tbtId: 'TBT-Id',
  kind: 'TBT-Image-Kind',
  hash: 'TBT-Image-Hash',
} as const

/** La ruta publica de nuestro bucket de obras. Nada fuera de aqui se publica. */
const WORKS_MEDIA_PATH = '/storage/v1/object/public/works-media/'

/**
 * El origen tiene que ser NUESTRO almacen.
 *
 * `chain_image_url` la escribe el navegador al crear el borrador, asi que la
 * decide quien tenga sesion — y esto la lee EN EL SERVIDOR y trae lo que haya al
 * otro lado. Sin esta comprobacion, una llamada preparada a mano haria que
 * nuestro servidor pidiera una direccion interna y publicara la respuesta en un
 * almacen del que no se retira nada.
 *
 * Se fija contra el proyecto de Supabase, no contra una lista de dominios: lo
 * unico que se publica es un archivo que subimos nosotros mismos.
 */
export function assertPublishableSource(url: string): void {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) throw new Error('image: sin NEXT_PUBLIC_SUPABASE_URL no se puede saber que origen es el nuestro.')

  let u: URL
  let ours: URL
  try { u = new URL(url); ours = new URL(base) } catch {
    throw new Error('image: el origen no es una URL.')
  }

  if (u.protocol !== 'https:' || u.origin !== ours.origin) {
    throw new Error(`image: el origen '${u.origin}' no es nuestro almacen.`)
  }
  if (!u.pathname.startsWith(WORKS_MEDIA_PATH)) {
    throw new Error('image: solo se publica lo que esta en works-media.')
  }
}

export type PublishedImage = {
  uri: string
  /** sha256 de los BYTES PUBLICADOS, no del archivo de origen. */
  hash: string
  kind: ChainImageKind
  bytes: number
}

const sha256 = (b: Uint8Array): string =>
  'sha256:' + createHash('sha256').update(b).digest('hex')

/**
 * Publica la imagen elegida y devuelve donde quedo.
 *
 * Como `publishRecord`, NO reintenta: dos copias de la misma obra en un almacen
 * permanente, con dos URIs y sin nada que las relacione, no es un estado que
 * este modelo sepa expresar. Quien llame guarda la URI y reintenta contra ella.
 */
export async function publishWorkImage(opts: {
  sourceUrl: string
  kind: ChainImageKind
  tbtId: string
}): Promise<PublishedImage> {
  assertPublishableSource(opts.sourceUrl)

  const res = await fetch(opts.sourceUrl)
  if (!res.ok) throw new Error(`image: no se pudo leer el origen (${res.status}).`)

  const raw = new Uint8Array(await res.arrayBuffer())

  // El tipo lo deciden los bytes. Una cabecera `Content-Type` la escribe quien
  // sirve el archivo, y aqui hace falta saber que es de verdad para poder
  // recorrerlo entero.
  const clean = stripMetadata(raw)

  if (clean.bytes.length > MAX_PUBLISH_BYTES) {
    throw new Error(
      `image: ${clean.bytes.length} bytes supera el techo de ${MAX_PUBLISH_BYTES}. No se publica.`
    )
  }

  const hash = sha256(clean.bytes)
  const ext = clean.mediaType === 'image/png' ? 'png' : 'jpg'

  const uri = await uploadToArweave(
    toMetaplexFile(clean.bytes, `${opts.tbtId}-${opts.kind}.${ext}`, {
      contentType: clean.mediaType,
      tags: [
        { name: IMAGE_TAGS.app, value: 'tbt.cafe' },
        { name: IMAGE_TAGS.tbtId, value: opts.tbtId },
        { name: IMAGE_TAGS.kind, value: opts.kind },
        { name: IMAGE_TAGS.hash, value: hash },
        { name: 'Content-Type', value: clean.mediaType },
      ],
    })
  )

  return { uri, hash, kind: opts.kind, bytes: clean.bytes.length }
}
