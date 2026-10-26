/**
 * Los creditos de la clave de almacenamiento — Work Order Chains 01, 5.1.
 *
 * Sin opciones solo lee: la direccion de almacenamiento, el servicio, los
 * creditos y cuantas imagenes al techo de 8 MB pagan.
 *
 *   npm run chain:storage-credits -- --network devnet
 *
 * Con --top-up y --execute recarga (gasta SOL). En mainnet paga el payer, en
 * creditos de Turbo para la direccion de almacenamiento; en devnet paga la
 * clave de almacenamiento a Irys devnet. Lo corre una persona, con las claves
 * en su entorno y nunca en un archivo del repositorio:
 *
 *   SOLANA_NETWORK=mainnet-beta SOLANA_RPC_URL=… \
 *   SOLANA_PAYER_PRIVATE_KEY=… TBT_STORAGE_PRIVATE_KEY=… \
 *   npm run chain:storage-credits -- --network mainnet-beta --top-up 50000000 --execute
 *
 * Se niega si la red del entorno no es la que se nombra en la linea de comandos.
 */

export {}

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

  const { storageCredits, topUpStorageCredits } = await import('../src/lib/chain/storage-credits')
  const show = async () => {
    const c = await storageCredits()
    console.log(`network:   ${network}`)
    console.log(`storage:   ${c.address}`)
    console.log(`service:   ${c.service}`)
    console.log(`credits:   ${c.credits} ${c.unit}`)
    console.log(`8 MB image: ${c.perRegistration} ${c.unit} → ${c.perRegistration > 0 ? Math.floor(c.credits / c.perRegistration) : '?'} full images`)
  }
  await show()

  const topUp = argAfter('--top-up')
  if (topUp === null) return
  const lamports = Number(topUp)
  if (!Number.isInteger(lamports) || lamports <= 0) refuse('--top-up takes a whole number of lamports')
  if (process.argv.indexOf('--execute') !== -1) {
    const signature = await topUpStorageCredits(lamports)
    console.log(`\ntopped up ${lamports} lamports: ${signature}`)
    await show()
  } else {
    console.log(`\nwould top up ${lamports} lamports (${lamports / 1e9} SOL). Add --execute to pay.`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
