import { Readable } from 'stream'
import { PublicKey } from '@solana/web3.js'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { createData, SolanaSigner, type DataItem } from '@dha-team/arbundles'
import { TurboFactory } from '@ardrive/turbo-sdk'
import { SOLANA_NETWORK } from '@/lib/solana/config'
import { readSecret } from '@/lib/solana/keys'

/**
 * Toda subida a Arweave la firma la clave de almacenamiento — Chains 01, 5.1.
 *
 * El firmante del primer registro de mainnet es la identidad permanente de
 * tbt.cafe en Arweave (5.2), y el titulo atado comprueba los registros contra
 * la direccion de esta clave. Por eso el firmante se decide aqui y solo aqui:
 * el item ANS-104 se firma en este proceso con TBT_STORAGE_PRIVATE_KEY, y quien
 * firmo se lee de los bytes firmados, no de lo que conteste un servicio.
 *
 * Despues, el mismo item firmado va a un sitio u otro segun la red:
 *  - mainnet: ArDrive Turbo. Lo paga el saldo de creditos de la clave de
 *    almacenamiento, que el payer recarga en SOL (storage-credits.ts). Lo de
 *    menos de 105 KiB (registros y pruebas) es gratis.
 *  - devnet: Irys devnet, financiado por la propia clave de almacenamiento.
 *    Turbo no tiene red de pruebas: cada subida suya es permanente en mainnet.
 *
 * Reemplaza al driver de Irys de la libreria vieja de Metaplex, que firmaba con
 * el payer.
 */

/** A donde va el item firmado, por red. */
export const UPLOAD_SERVICE = {
  'mainnet-beta': 'https://upload.ardrive.io',
  devnet: 'https://devnet.irys.xyz',
} as const

const IRYS_DEVNET = UPLOAD_SERVICE.devnet

export type ArweaveTag = { name: string; value: string }

/** Lo que sube: los bytes exactos, su nombre y sus etiquetas. */
export type ArweaveFile = {
  buffer: Buffer
  fileName: string
  contentType: string
  tags: ArweaveTag[]
}

export function arweaveFile(bytes: Uint8Array | string, fileName: string, contentType: string, tags: ArweaveTag[]): ArweaveFile {
  return { buffer: Buffer.from(bytes), fileName, contentType, tags }
}

/** La direccion de la clave de almacenamiento: la identidad de tbt.cafe en Arweave. */
export function storageAddress(): string {
  return new PublicKey(readSecret('storage').slice(32, 64)).toBase58()
}

/** Firma el archivo con la clave de almacenamiento. No sube nada. */
export async function signForArweave(file: ArweaveFile): Promise<DataItem> {
  const signer = new SolanaSigner(base58.deserialize(readSecret('storage'))[0])
  const item = createData(new Uint8Array(file.buffer), signer, { tags: file.tags })
  await item.sign(signer)
  return item
}

/** Quien firmo el item, leido de sus bytes (el owner de un item Solana es la clave publica). */
export function signerOf(item: DataItem): string {
  return new PublicKey(item.rawOwner).toBase58()
}

/** Sube un item ya firmado y devuelve su ID de Arweave. */
export async function uploadSigned(item: DataItem): Promise<string> {
  const raw = item.getRaw()
  let id: string

  if (SOLANA_NETWORK === 'mainnet-beta') {
    const res = await TurboFactory.unauthenticated({ token: 'solana' }).uploadSignedDataItem({
      dataItemStreamFactory: () => Readable.from(raw),
      dataItemSizeFactory: () => raw.length,
    })
    id = res.id
  } else {
    const res = await fetch(`${IRYS_DEVNET}/tx/solana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(raw),
    })
    if (!res.ok) throw new Error(`arweave: Irys devnet refused the upload (${res.status}): ${(await res.text()).slice(0, 200)}`)
    id = ((await res.json()) as { id: string }).id
  }

  // El ID de un item es el hash de su firma: si el servicio devuelve otro, no
  // guardo lo que firmamos. Turbo lo escribe en base64url e Irys devnet en
  // base58, asi que se comparan los 32 bytes y se guarda la forma de Arweave.
  if (!sameId(id, item)) throw new Error(`arweave: the service answered ${id} for the item signed as ${item.id}.`)
  return item.id
}

/** El mismo ID en base64url (Arweave, Turbo) o en base58 (Irys). */
export function sameId(answered: string, item: DataItem): boolean {
  const want = Buffer.from(item.rawId)
  if (Buffer.from(answered, 'base64url').equals(want)) return true
  try {
    return Buffer.from(base58.serialize(answered)).equals(want)
  } catch {
    return false
  }
}
