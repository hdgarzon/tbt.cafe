import { Connection, clusterApiUrl, Cluster } from '@solana/web3.js'

// Solana network configuration
export const SOLANA_NETWORK = (process.env.SOLANA_NETWORK || 'devnet') as Cluster

/**
 * El endpoint RPC. En mainnet no puede ser el publico.
 *
 * Esto decia `if (mainnet && SOLANA_RPC_URL)`: con la variable ausente la
 * condicion es falsa y se cae al `clusterApiUrl('mainnet-beta')` de abajo, que
 * es el endpoint publico de Solana. Ese endpoint esta limitado por tasa y no
 * garantiza nada, asi que la primera acuñacion real fallaria de forma
 * intermitente sin que nada dijera por que.
 *
 * Hoy no muerde porque la red es devnet, donde el publico es lo correcto. El
 * dia que se cambie a mainnet sin poner la variable, muerde en silencio. Por
 * eso ahora se dice en voz alta en vez de degradarse.
 */
export const getRpcUrl = (): string => {
  if (SOLANA_NETWORK === 'mainnet-beta') {
    const url = process.env.SOLANA_RPC_URL
    if (!url) {
      throw new Error(
        'SOLANA_RPC_URL is required on mainnet-beta: the public endpoint is rate limited and will fail mints intermittently'
      )
    }
    return url
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
  // Solscan sirve las dos redes desde el mismo host; lo que cambia es el
  // parametro de cluster. Antes habia un ternario con las dos ramas iguales.
  const baseUrl = 'https://solscan.io'

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
