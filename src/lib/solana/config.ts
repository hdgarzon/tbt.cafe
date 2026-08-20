import { Connection, clusterApiUrl, Cluster } from '@solana/web3.js'

// Solana network configuration
export const SOLANA_NETWORK = (process.env.SOLANA_NETWORK || 'devnet') as Cluster

// Use custom RPC for mainnet, otherwise use Solana's public endpoints
export const getRpcUrl = (): string => {
  if (SOLANA_NETWORK === 'mainnet-beta' && process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL
  }
  return clusterApiUrl(SOLANA_NETWORK)
}

// Solana connection singleton
let connection: Connection | null = null

export const getConnection = (): Connection => {
  if (!connection) {
    connection = new Connection(getRpcUrl(), 'confirmed')
  }
  return connection
}

// Explorer URLs
export const getExplorerUrl = (address: string, type: 'address' | 'tx' = 'address'): string => {
  const baseUrl = SOLANA_NETWORK === 'mainnet-beta'
    ? 'https://solscan.io'
    : 'https://solscan.io'
  
  const cluster = SOLANA_NETWORK === 'mainnet-beta' ? '' : `?cluster=${SOLANA_NETWORK}`
  
  if (type === 'tx') {
    return `${baseUrl}/tx/${address}${cluster}`
  }
  return `${baseUrl}/account/${address}${cluster}`
}

// NFT Collection info
export const TBT_COLLECTION = {
  name: 'TBT Certificates',
  symbol: 'TBT',
  description: 'Certificados de autenticidad de obras de arte emitidos por TBT.cafe'
}
