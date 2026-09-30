import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey,
  type PublicKey as UmiPublicKey,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import {
  create,
  createCollection,
  fetchAsset,
  fetchCollection,
  mplCore,
  transfer,
  update,
} from '@metaplex-foundation/mpl-core'
import { getRpcUrl } from './config'
import { holdingAddress } from './holding'
import { assertDistinctSecrets, assertPayerCanMint, readSecret } from './keys'

/**
 * El token del titulo sobre Metaplex Core — Chains 01, Stage 4 (opcion C).
 *
 * Reemplaza a `nft.ts` (Metaplex JS). `complete-tbt` acuna con esto y las
 * enmiendas repuntan con esto. Necesita SOLANA_AUTHORITY_PRIVATE_KEY y
 * TBT_COLLECTION_ADDRESS (Stage 7 y 4.2).
 *
 * Tres claves distintas en cada operacion, y ninguna es la del dueno:
 *  - el payer paga las comisiones;
 *  - la autoridad firma: acuna, mueve (delegado permanente) y repunta;
 *  - el dueno es una direccion de tenencia, que no tiene clave.
 *
 * Probado en devnet (prueba b): Core acepta una direccion fuera de la curva
 * como duena, el delegado permanente la mueve sin firma del dueno, y el payer
 * solo es rechazado.
 */

function collectionAddress(): UmiPublicKey {
  const address = process.env.TBT_COLLECTION_ADDRESS
  if (!address) throw new Error('TBT_COLLECTION_ADDRESS not configured: create the collection first (Stage 4.2).')
  return publicKey(address)
}

/** La direccion de tenencia del numero de titulo, en el tipo de Umi. */
function holding(titleNumber: string): UmiPublicKey {
  return publicKey(holdingAddress(titleNumber).toBase58())
}

function connect(): { umi: Umi; auth: Signer } {
  const payer = readSecret('payer')
  const authority = readSecret('authority')
  assertDistinctSecrets({ payer, authority })

  const umi = createUmi(getRpcUrl()).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer)))
  const auth = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(authority))
  return { umi, auth }
}

const signatureOf = (result: { signature: Uint8Array }) => base58.deserialize(result.signature)[0]

/**
 * Crea la coleccion "tbt.cafe" — Stage 4.2. Una vez por red.
 *
 * Autoridad de actualizacion y delegado permanente de transferencia: la clave
 * de autoridad. La direccion que devuelve va a TBT_COLLECTION_ADDRESS.
 */
export async function createTitleCollection(uri: string): Promise<{ collection: string; signature: string }> {
  const { umi, auth } = connect()
  const collection = generateSigner(umi)
  const result = await createCollection(umi, {
    collection,
    name: 'tbt.cafe',
    uri,
    updateAuthority: auth.publicKey,
    plugins: [{ type: 'PermanentTransferDelegate', authority: { type: 'Address', address: auth.publicKey } }],
  }).sendAndConfirm(umi)
  return { collection: collection.publicKey, signature: signatureOf(result) }
}

/**
 * Acuna el token de un titulo — Stage 4.4.
 *
 * Nombre = TBT ID; URI = el registro de registracion publicado; dueno = la
 * tenencia de `<TBT ID>-1`. Sin campo de regalia: la lleva el registro.
 * Sin registro no hay token (Stage 1.1).
 */
export async function mintTitleToken(
  work: { tbtId: string },
  registrationRecordUri: string
): Promise<{ assetAddress: string; signature: string }> {
  if (!registrationRecordUri) throw new Error('mintTitleToken: no registration record URI; the work waits for the sweep.')

  const { umi, auth } = connect()
  assertPayerCanMint((await umi.rpc.getBalance(umi.identity.publicKey)).basisPoints)

  const asset = generateSigner(umi)
  const result = await create(umi, {
    asset,
    collection: await fetchCollection(umi, collectionAddress()),
    name: work.tbtId,
    uri: registrationRecordUri,
    owner: holding(`${work.tbtId}-1`),
    authority: auth,
  }).sendAndConfirm(umi)

  return { assetAddress: asset.publicKey, signature: signatureOf(result) }
}

/**
 * Mueve el token de una tenencia a la siguiente — Stage 4.5.
 *
 * Lo firma la autoridad como delegado permanente; ninguna tenencia tiene clave.
 * Si el activo no esta donde el registro dice, se niega en vez de moverlo:
 * eso es una discrepancia que un humano tiene que ver, no un reintento.
 * La firma devuelta va al registro de procedencia.
 */
export async function moveTitleToken(
  assetAddress: string,
  fromTitleNumber: string,
  toTitleNumber: string
): Promise<{ signature: string }> {
  const { umi, auth } = connect()
  const asset = await fetchAsset(umi, publicKey(assetAddress))

  if (asset.owner === holding(toTitleNumber)) {
    throw new Error(`moveTitleToken: ${assetAddress} is already at ${toTitleNumber}; nothing to sign.`)
  }
  if (asset.owner !== holding(fromTitleNumber)) {
    throw new Error(`moveTitleToken: ${assetAddress} is not at the holding of ${fromTitleNumber}.`)
  }

  const result = await transfer(umi, {
    asset,
    collection: await fetchCollection(umi, collectionAddress()),
    newOwner: holding(toTitleNumber),
    authority: auth,
  }).sendAndConfirm(umi)

  return { signature: signatureOf(result) }
}

/** Repunta la URI del token a la enmienda — Stage 4.6. El registro viejo sigue en Arweave. */
export async function repointTitleToken(assetAddress: string, uri: string): Promise<void> {
  if (!uri) throw new Error('repointTitleToken: missing the new record URI.')

  const { umi, auth } = connect()
  const asset = await fetchAsset(umi, publicKey(assetAddress))
  if (asset.uri === uri) return

  await update(umi, {
    asset,
    collection: await fetchCollection(umi, collectionAddress()),
    uri,
    authority: auth,
  }).sendAndConfirm(umi)
}
