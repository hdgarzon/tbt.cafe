import { Keypair } from '@solana/web3.js'
import { Metaplex, keypairIdentity, irysStorage } from '@metaplex-foundation/js'
import { getConnection, SOLANA_NETWORK } from '@/lib/solana/config'
import { readSecret } from '@/lib/solana/keys'

/**
 * El driver de subida a Arweave de hoy: Irys, pagado por el payer.
 *
 * Es lo unico que queda de la libreria vieja de Metaplex. El token ya se acuna
 * con Core (`src/lib/solana/token.ts`); esto se va entero con el Stage 5.1,
 * cuando ArDrive Turbo sube firmando con la clave de almacenamiento.
 */
export function getMetaplex(): Metaplex {
  const payer = Keypair.fromSecretKey(readSecret('payer'))
  return Metaplex.make(getConnection())
    .use(keypairIdentity(payer))
    .use(irysStorage({
      address: SOLANA_NETWORK === 'mainnet-beta'
        ? 'https://node1.irys.xyz'
        : 'https://devnet.irys.xyz',
      providerUrl: SOLANA_NETWORK === 'mainnet-beta'
        ? process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com',
      timeout: 60000,
    }))
}
