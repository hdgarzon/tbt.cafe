/**
 * Publicar un registro en Arweave.
 *
 * Chain Spec 01, Item 6 paso 3: el registro sube ANTES del mint, porque la URI
 * que se escribe en cadena tiene que apuntar a algo que ya exista.
 *
 * LOS BYTES QUE SUBEN SON LOS QUE SE HASHEAN
 *
 * Esto es lo unico que hace que el esquema sirva para algo. `metaplex.storage()`
 * ofrece `uploadJson`, que toma un objeto y lo reserializa con `JSON.stringify`
 * antes de subirlo — orden de claves del motor, espaciado del motor. Los bytes
 * publicados dejarian de coincidir con los que `canonicalize` produjo y
 * `recordHash` firmo, y cualquiera que descargara el registro para verificarlo
 * obtendria un hash distinto.
 *
 * Por eso se construye el archivo a mano con la cadena canonica literal. La
 * unica transformacion entre `canonicalize()` y Arweave es UTF-8.
 *
 * LAS ETIQUETAS
 *
 * Arweave permite etiquetar una subida, y eso es lo que hace un registro
 * encontrable sin un indice propio: se puede consultar por TBT, por tipo o por
 * hash contra cualquier pasarela. `Content-Type` va tambien como etiqueta
 * porque es lo que leen las pasarelas al servirlo.
 */
import { toMetaplexFile, type MetaplexFile } from '@metaplex-foundation/js'
import { canonicalize, recordHash } from './serialize'
import { assertNoIdentifiers } from './pseudonym'
import { getMetaplex } from '@/lib/solana/nft'
import { SOLANA_NETWORK } from '@/lib/solana/config'

/** Nombres de etiqueta, en un sitio para que la prueba y el modulo no diverjan. */
export const RECORD_TAGS = {
  app: 'App-Name',
  schema: 'TBT-Schema',
  type: 'TBT-Record-Type',
  tbtId: 'TBT-Id',
  hash: 'TBT-Record-Hash',
} as const

/** Lo minimo que un registro trae y que esto necesita leer. */
type PublishableRecord = {
  schema: string
  type: string
  tbt_id: string
  [key: string]: unknown
}

/**
 * El archivo tal como sube. Separado de la subida para poder comprobarlo sin
 * red: que lleve la forma canonica es la propiedad que importa, y no deberia
 * hacer falta pagar una transaccion para verificarla.
 */
export function recordFileFor(record: PublishableRecord): MetaplexFile {
  /*
   * El ultimo punto antes de lo permanente — Item 10.
   *
   * Va aqui y no en `records.ts` porque este es el estrangulamiento: todo lo
   * que llega a Arweave pasa por esta funcion, venga del registro, de la
   * procedencia o de una enmienda. Una lista de claves prohibidas no atrapa un
   * correo dentro de un texto libre; esto mira el valor.
   */
  assertNoIdentifiers(record)

  const canonical = canonicalize(record)
  const hash = recordHash(record)

  return toMetaplexFile(canonical, `${record.tbt_id}-${record.type}.json`, {
    contentType: 'application/json',
    tags: [
      { name: RECORD_TAGS.app, value: 'tbt.cafe' },
      { name: RECORD_TAGS.schema, value: record.schema },
      { name: RECORD_TAGS.type, value: record.type },
      { name: RECORD_TAGS.tbtId, value: record.tbt_id },
      { name: RECORD_TAGS.hash, value: hash },
      { name: 'Content-Type', value: 'application/json' },
    ],
  })
}

/**
 * La URI que de verdad resuelve.
 *
 * El driver devuelve siempre `https://arweave.net/<id>`, y en devnet eso es un
 * 404: lo subido a Irys devnet vive en su propia pasarela y no llega a la red
 * Arweave. Comprobado subiendo un registro y pidiendolo por las tres.
 *
 * Importa porque esta URI se escribe EN CADENA (Item 6, paso 4) y el spec pide
 * que apunte a algo que exista. Una direccion permanente hacia un 404 es peor
 * que no tenerla: parece verificable y no lo es.
 */
function gatewayUri(driverUri: string): string {
  const id = driverUri.split('/').filter(Boolean).pop()
  if (!id) return driverUri
  return SOLANA_NETWORK === 'mainnet-beta'
    ? `https://arweave.net/${id}`
    : `https://devnet.irys.xyz/${id}`
}

export type PublishedRecord = {
  /** Una URL de pasarela que resuelve en esta red, no un `ar://`. */
  uri: string
  /** El mismo hash que va en la etiqueta, para guardarlo junto a la URI. */
  hash: string
  bytes: number
}

/**
 * Sube el registro y devuelve donde quedo.
 *
 * NO reintenta. Un reintento ciego publicaria un segundo registro del mismo
 * TBT sin enlace `supersedes` entre ambos, y esa es la unica forma que este
 * modelo no sabe expresar (Item 6, CAUTION). Quien llame decide, y si el mint
 * posterior falla la instruccion del spec es reintentar el MINT contra la URI
 * ya guardada, nunca volver a subir.
 */
export async function publishRecord(record: PublishableRecord): Promise<PublishedRecord> {
  const file = recordFileFor(record)
  const driverUri = await getMetaplex().storage().upload(file)

  return {
    uri: gatewayUri(driverUri),
    hash: recordHash(record),
    bytes: file.buffer.length,
  }
}
