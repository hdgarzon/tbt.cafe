import { getExplorerUrl } from './config'
import { updateNftMetadata, WorkNftData } from './nft'

export interface TransferResult {
  success: boolean
  signature?: string
  explorerUrl?: string
  newTokenUri?: string
  error?: string
}

/**
 * Process a TBT transfer by updating the NFT metadata on-chain.
 * In the single-wallet model the NFT stays in the project wallet;
 * only the metadata attributes (Current Owner, History) are updated.
 */
export async function processTransferOnChain(
  mintAddress: string,
  updatedWork: WorkNftData
): Promise<TransferResult> {
  try {
    console.log(`Updating on-chain metadata for transfer of ${mintAddress}`)

    const { tokenUri } = await updateNftMetadata(mintAddress, updatedWork)

    const explorerUrl = getExplorerUrl(mintAddress)

    console.log(`Metadata updated successfully for ${mintAddress}`)

    return {
      success: true,
      explorerUrl,
      newTokenUri: tokenUri,
    }
  } catch (error: any) {
    console.error('Error updating NFT metadata for transfer:', error)
    return {
      success: false,
      error: error.message || 'Failed to update NFT metadata',
    }
  }
}
