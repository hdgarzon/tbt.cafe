import { Keypair, PublicKey } from '@solana/web3.js'
import { Metaplex, keypairIdentity, irysStorage } from '@metaplex-foundation/js'
import { getConnection, SOLANA_NETWORK, TBT_COLLECTION } from './config'

/**
 * Lo unico que el mint necesita de la obra — Chains 01, Stage 1.1.
 *
 * Antes llevaba precio, regalia, lugar, clima e historial de duenos, y los
 * subia como metadata aparte cuando el registro de registracion habia fallado.
 * Ese camino ya no existe: la URI en cadena es la del registro, que pasa por
 * assertNoIdentifiers, y nada mas se publica desde aqui.
 */
export interface TitleTokenInput {
  tbtId: string
}

/**
 * Get payer keypair from environment
 */
export function getPayerKeypair(): Keypair {
  const privateKey = process.env.SOLANA_PAYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('SOLANA_PAYER_PRIVATE_KEY not configured')
  }
  
  // Support both base58 and array formats
  try {
    const decoded = Buffer.from(JSON.parse(privateKey))
    return Keypair.fromSecretKey(decoded)
  } catch {
    // Try base58 decode
    const bs58 = require('bs58')
    return Keypair.fromSecretKey(bs58.decode(privateKey))
  }
}

/**
 * Create Metaplex instance with Irys storage for Devnet
 */
export function getMetaplex(payer?: Keypair): Metaplex {
  const connection = getConnection()
  const payerKeypair = payer || getPayerKeypair()
  
  const metaplex = Metaplex.make(connection)
    .use(keypairIdentity(payerKeypair))
    .use(irysStorage({
      address: SOLANA_NETWORK === 'mainnet-beta' 
        ? 'https://node1.irys.xyz' 
        : 'https://devnet.irys.xyz',
      providerUrl: SOLANA_NETWORK === 'mainnet-beta'
        ? process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com',
      timeout: 60000, // 60 second timeout for Devnet
    }))
  
  return metaplex
}

/**
 * Sleep utility for retry logic
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 2000
): Promise<T> {
  let lastError: Error = new Error('Unknown error')
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      console.warn(`Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error?.message || error)
      
      // Check if it's a retryable error (bundler/confirmation issues)
      const isRetryable = error?.message?.includes('Confirmed tx not found') ||
                         error?.message?.includes('timeout') ||
                         error?.message?.includes('503') ||
                         error?.message?.includes('429')
      
      if (!isRetryable || attempt === maxRetries) {
        throw lastError
      }
      
      // Exponential backoff: 2s, 4s, 8s...
      const delayMs = baseDelayMs * Math.pow(2, attempt)
      console.log(`Retrying in ${delayMs}ms...`)
      await sleep(delayMs)
    }
  }
  
  throw lastError
}

/**
 * Acuna el token de un titulo — Chains 01, Stage 1.1.
 *
 * Exige la URI del registro de registracion ya publicado. Una obra sin
 * registro no se acuna: espera al barrido de recuperacion (Stage 7). No hay
 * camino alternativo que suba metadata propia.
 */
export async function mintTitleToken(
  work: TitleTokenInput,
  registrationRecordUri: string
): Promise<{ mintAddress: string; tokenUri: string; signature: string }> {
  if (!registrationRecordUri) throw new Error('mintTitleToken: no registration record URI; the work waits for the sweep.')

  const payerKeypair = getPayerKeypair()
  const metaplex = getMetaplex(payerKeypair)
  const tokenUri = registrationRecordUri

  console.log(`Minting title token for ${work.tbtId} against ${tokenUri}`)

  const { nft, response } = await withRetry(async () => {
    console.log('Creating NFT on Solana...')
    return await metaplex.nfts().create({
      uri: registrationRecordUri,
      /*
       * El TBT ID, no el titulo — Item 6, Change A.
       *
       * `name` topa en 32 BYTES y un acento cuesta dos. "Nocturno en Medellin"
       * son 21 caracteres y 22 bytes; un titulo español o portugues mas largo
       * se trunca en silencio o falla. El TBT ID es ASCII de longitud fija y no
       * puede.
       */
      name: work.tbtId,
      symbol: TBT_COLLECTION.symbol,
      /*
       * Cero — Item 6, Change A.
       *
       * Es decorativo: tbt.cafe cobra las regalias del lado del servidor. Pero
       * es un numero PUBLICO que contradice a `work_commerce` en cuanto los dos
       * difieren, y un mercado podria actuar sobre el. Estaba en 500 fijo.
       */
      sellerFeeBasisPoints: 0,
      tokenOwner: payerKeypair.publicKey,
      isMutable: true,
    })
  }, 3, 3000)
  
  console.log(`NFT minted: ${nft.address.toString()}`)
  
  return {
    mintAddress: nft.address.toString(),
    tokenUri,
    /*
     * La firma de la transaccion, que no es la direccion del mint.
     *
     * El registro de procedencia tiene un campo `solana_signature` y hasta
     * ahora recibia `mintAddress`: una direccion de cuenta en un campo que
     * significa firma. En un registro permanente eso no es impreciso, es
     * falso — quien lo verifique buscara una transaccion que no existe con
     * ese identificador.
     */
    signature: response.signature,
  }
}

/**
 * Mueve la URI del activo al registro que la supersede — Item 5.
 *
 * «Safe because Solana is a pointer — moving it does not destroy what it pointed
 * at, and the new record links backwards.» El registro anterior sigue en Arweave
 * y el nuevo lo nombra en `supersedes`, asi que la cadena se camina hacia atras
 * desde donde apunte la cadena.
 *
 * Solo mueve la URI. `name` es el TBT ID desde el Item 6 Change A —ASCII de
 * longitud fija, por debajo del tope de 32 bytes— y no tiene por que cambiar
 * nunca; reescribirlo aqui seria arriesgar un truncamiento silencioso a cambio
 * de nada.
 *
 * Esto reemplaza a `updateNftMetadata`, que subia metadata NUEVA y repuntaba a
 * ella. Su unico llamante era la transferencia, que dejo de reescribir la
 * registracion en el Item 7; quedaba muerto, y su forma —«sube algo y apunta
 * ahi»— es justo la que una enmienda no debe tener: lo que se publica ya se
 * publico, con su hash y su ancla.
 */
export async function repointNft(mintAddress: string, uri: string): Promise<void> {
  if (!uri) throw new Error('repointNft: falta la URI del registro nuevo.')

  const metaplex = getMetaplex(getPayerKeypair())
  const nft = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(mintAddress) })

  if (!nft.isMutable) {
    // No es recuperable reintentando: el activo se acuño inmutable y su puntero
    // se queda donde esta. Quien llame lo anota y sigue — la enmienda ya esta
    // publicada, que es la parte permanente.
    throw new Error('repointNft: el activo es inmutable; su URI no se puede mover.')
  }
  if (nft.uri === uri) return

  await withRetry(async () => {
    await metaplex.nfts().update({ nftOrSft: nft, uri })
  }, 3, 3000)

  console.log(`NFT ${mintAddress} repointed to ${uri}`)
}

/**
 * Get the project wallet's public key as a string.
 * Used by API routes to reference the single wallet that holds all NFTs.
 */
export function getProjectWalletPublicKey(): string {
  return getPayerKeypair().publicKey.toString()
}
