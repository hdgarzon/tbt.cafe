import { Keypair, PublicKey } from '@solana/web3.js'
import { Metaplex, keypairIdentity, irysStorage } from '@metaplex-foundation/js'
import { getConnection, SOLANA_NETWORK, TBT_COLLECTION } from './config'

// Transfer history entry
export interface TransferHistoryEntry {
  type: 'creation' | 'transfer'
  date: string
  fromName?: string  // null for creation
  toName: string
  transferType?: 'sale' | 'gift' // for transfers only
  price?: string     // for sales only
  currency?: string  // for sales only
}

// Work data for NFT creation
export interface WorkNftData {
  tbtId: string
  title: string
  description?: string
  category?: string
  technique?: string
  creatorName: string
  mediaUrl?: string
  certifiedAt: string
  transferCode: string
  // New fields for complete history
  creationLocation?: string
  creationWeather?: string
  elaborationType?: string
  marketPrice?: number
  currency?: string
  royaltyPercentage?: number
  // Transfer history
  transferHistory?: TransferHistoryEntry[]
}

/**
 * Generate NFT metadata from work data (Metaplex compatible)
 * Includes complete history and provenance tracking
 */
export function generateNftMetadata(work: WorkNftData) {
  const externalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tbt.cafe'}/work/${work.tbtId}`
  
  // Core attributes
  const attributes: Array<{ trait_type: string; value: string | number }> = [
    { trait_type: 'TBT ID', value: work.tbtId },
    { trait_type: 'Creator', value: work.creatorName },
    { trait_type: 'Certified Date', value: work.certifiedAt },
    { trait_type: 'Transfer Code', value: work.transferCode },
  ]

  // Category and technique
  if (work.category) {
    attributes.push({ trait_type: 'Category', value: work.category })
  }
  if (work.technique) {
    attributes.push({ trait_type: 'Technique', value: work.technique })
  }

  // Context and provenance
  if (work.creationLocation) {
    attributes.push({ trait_type: 'Creation Location', value: work.creationLocation })
  }
  if (work.creationWeather) {
    attributes.push({ trait_type: 'Creation Weather', value: work.creationWeather })
  }
  if (work.elaborationType) {
    attributes.push({ trait_type: 'Elaboration Type', value: work.elaborationType })
  }

  // Commercial info
  if (work.marketPrice !== undefined && work.currency) {
    attributes.push({ trait_type: 'Initial Price', value: `${work.marketPrice} ${work.currency}` })
  }
  if (work.royaltyPercentage !== undefined) {
    attributes.push({ trait_type: 'Artist Royalty', value: `${work.royaltyPercentage}%` })
  }

  // Transfer history - stored as attributes for on-chain provenance
  // The history is immutable once recorded
  const history = work.transferHistory || []
  
  // Always add creation as first history entry if not present
  if (history.length === 0) {
    history.push({
      type: 'creation',
      date: work.certifiedAt,
      toName: work.creatorName,
    })
  }

  // Add history entries as attributes (limited to prevent excessive metadata size)
  attributes.push({ trait_type: 'Total Owners', value: history.length })
  
  // Add the last 10 history entries (most recent)
  const recentHistory = history.slice(-10)
  recentHistory.forEach((entry, index) => {
    const historyIndex = history.length - recentHistory.length + index + 1
    
    if (entry.type === 'creation') {
      attributes.push({ 
        trait_type: `History ${historyIndex}`, 
        value: `Created by ${entry.toName} on ${entry.date}` 
      })
    } else {
      const transferInfo = entry.transferType === 'sale' && entry.price
        ? `Sold for ${entry.price} ${entry.currency || 'USD'}`
        : entry.transferType === 'gift' ? 'Gifted' : 'Transferred'
      
      attributes.push({ 
        trait_type: `History ${historyIndex}`, 
        value: `${transferInfo} from ${entry.fromName || 'Unknown'} to ${entry.toName} on ${entry.date}` 
      })
    }
  })

  // Add current owner (last in history)
  const currentOwner = history[history.length - 1]
  if (currentOwner) {
    attributes.push({ trait_type: 'Current Owner', value: currentOwner.toName })
  }

  return {
    name: work.title,
    symbol: TBT_COLLECTION.symbol,
    description: work.description || `Obra certificada: ${work.title} por ${work.creatorName}`,
    image: work.mediaUrl || '',
    external_url: externalUrl,
    attributes,
    properties: {
      files: work.mediaUrl ? [{ uri: work.mediaUrl, type: 'image/jpeg' }] : [],
      category: 'image',
      // Store complete history in properties for full provenance
      provenance: {
        creator: work.creatorName,
        createdAt: work.certifiedAt,
        totalTransfers: Math.max(0, history.length - 1),
        history: history,
      }
    }
  }
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
 * Mint a TBT NFT to the project's wallet (single-wallet hybrid model).
 * All NFTs are owned by the project wallet; ownership is tracked
 * off-chain in Supabase and on-chain via mutable metadata attributes.
 */
export async function mintTBTNft(
  work: WorkNftData
): Promise<{ mintAddress: string; tokenUri: string }> {
  const payerKeypair = getPayerKeypair()
  const metaplex = getMetaplex(payerKeypair)
  const metadata = generateNftMetadata(work)
  
  console.log(`Minting NFT for TBT ${work.tbtId} to project wallet...`)
  
  const { uri: tokenUri } = await withRetry(async () => {
    console.log('Uploading metadata to Irys...')
    return await metaplex.nfts().uploadMetadata(metadata as any)
  }, 3, 3000)
  
  console.log(`Metadata uploaded: ${tokenUri}`)
  
  await sleep(2000)
  
  const { nft } = await withRetry(async () => {
    console.log('Creating NFT on Solana...')
    return await metaplex.nfts().create({
      uri: tokenUri,
      name: metadata.name,
      symbol: metadata.symbol,
      sellerFeeBasisPoints: 500,
      tokenOwner: payerKeypair.publicKey,
      isMutable: true,
    })
  }, 3, 3000)
  
  console.log(`NFT minted: ${nft.address.toString()}`)
  
  return {
    mintAddress: nft.address.toString(),
    tokenUri
  }
}

/**
 * Update NFT metadata with new transfer history
 * This updates the on-chain metadata to reflect the new ownership
 */
export async function updateNftMetadata(
  mintAddress: string,
  updatedWork: WorkNftData
): Promise<{ tokenUri: string }> {
  const metaplex = getMetaplex()
  
  // Find the existing NFT
  const nft = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(mintAddress) })
  
  if (!nft.isMutable) {
    console.warn('NFT is not mutable, cannot update metadata')
    return { tokenUri: nft.uri }
  }
  
  // Generate updated metadata with new history
  const updatedMetadata = generateNftMetadata(updatedWork)
  
  console.log(`Updating NFT metadata for ${mintAddress}...`)
  
  // Upload new metadata
  const { uri: newTokenUri } = await withRetry(async () => {
    return await metaplex.nfts().uploadMetadata(updatedMetadata as any)
  }, 3, 3000)
  
  console.log(`New metadata uploaded: ${newTokenUri}`)
  
  // Update the NFT to point to new metadata
  await withRetry(async () => {
    await metaplex.nfts().update({
      nftOrSft: nft,
      uri: newTokenUri,
      name: updatedMetadata.name,
    })
  }, 3, 3000)
  
  console.log(`NFT metadata updated successfully`)
  
  return { tokenUri: newTokenUri }
}

/**
 * Get the project wallet's public key as a string.
 * Used by API routes to reference the single wallet that holds all NFTs.
 */
export function getProjectWalletPublicKey(): string {
  return getPayerKeypair().publicKey.toString()
}
