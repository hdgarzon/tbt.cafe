/**
 * Crear la coleccion "tbt.cafe" de una red — Work Order Chains 01, 4.2 y 11.4.
 *
 * Una vez por red. Autoridad de actualizacion y delegado permanente de
 * transferencia: la clave de autoridad. Paga el payer. La direccion que imprime
 * va a TBT_COLLECTION_ADDRESS en Vercel (Production).
 *
 * Lo corre una persona, con las claves en su entorno y nunca en un archivo del
 * repositorio:
 *
 *   SOLANA_NETWORK=mainnet-beta SOLANA_RPC_URL=… \
 *   SOLANA_PAYER_PRIVATE_KEY=… SOLANA_AUTHORITY_PRIVATE_KEY=… \
 *   npm run chain:create-collection -- --network mainnet-beta --uri <collection metadata URL>
 *
 * Se niega si la red del entorno no es la que se nombra en la linea de
 * comandos, si TBT_COLLECTION_ADDRESS ya esta puesta (una segunda coleccion
 * partiria la cadena), o sin --uri.
 */

const args = process.argv.slice(2)
const argAfter = (flag: string): string | null => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}

function refuse(message: string): never {
  console.error(`refused: ${message}`)
  process.exit(2)
}

async function main(): Promise<void> {
  const network = process.env.SOLANA_NETWORK || 'devnet'
  const wanted = argAfter('--network')
  if (!wanted || wanted !== network) refuse(`SOLANA_NETWORK is ${network}; pass --network ${network} to confirm that is the network you mean`)
  if (process.env.TBT_COLLECTION_ADDRESS) refuse('TBT_COLLECTION_ADDRESS is already set: this network has its collection')
  const uri = argAfter('--uri')
  if (!uri || !uri.startsWith('https:')) refuse('--uri is required: the https URL of the collection metadata')

  const { createTitleCollection } = await import('../src/lib/solana/token')
  const { collection, signature } = await createTitleCollection(uri)
  console.log(`network:    ${network}`)
  console.log(`collection: ${collection}`)
  console.log(`signature:  ${signature}`)
  console.log('\nSet TBT_COLLECTION_ADDRESS to the collection address in Vercel (Production) and redeploy.')
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
