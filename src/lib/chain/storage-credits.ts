import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { TurboFactory } from '@ardrive/turbo-sdk'
import { SOLANA_NETWORK, getConnection, getRpcUrl } from '@/lib/solana/config'
import { readSecret } from '@/lib/solana/keys'
import { PUBLISH_CEILING_BYTES } from './reduce-image'
import { UPLOAD_SERVICE, storageAddress } from './storage-upload'

/**
 * Con que paga sus subidas la clave de almacenamiento — Chains 01, 5.1 y 7.2.2.
 *
 * mainnet: creditos de Turbo (winc) a nombre de la direccion de almacenamiento.
 * Los recarga el payer en SOL (7.1: el payer "recarga Turbo"); la clave de
 * almacenamiento no necesita tener SOL.
 *
 * devnet: saldo en Irys devnet (lamports), financiado por la propia clave de
 * almacenamiento con SOL de devnet.
 *
 * `perRegistration` es lo que cuesta subir una imagen al techo de 8 MB, en la
 * misma unidad: la alarma cuenta en registraciones, no en SOL.
 */

const IRYS_DEVNET = UPLOAD_SERVICE.devnet

export type StorageCredits = {
  address: string
  service: string
  credits: number
  unit: 'winc' | 'lamports'
  perRegistration: number
}

export async function storageCredits(): Promise<StorageCredits> {
  const address = storageAddress()

  if (SOLANA_NETWORK === 'mainnet-beta') {
    const turbo = TurboFactory.unauthenticated({ token: 'solana' })
    const [balance, costs] = await Promise.all([
      turbo.getBalance(address),
      turbo.getUploadCosts({ bytes: [PUBLISH_CEILING_BYTES] }),
    ])
    return { address, service: UPLOAD_SERVICE['mainnet-beta'], credits: Number(balance.winc), unit: 'winc', perRegistration: Number(costs[0].winc) }
  }

  const [balance, price] = await Promise.all([
    fetch(`${IRYS_DEVNET}/account/balance/solana?address=${address}`).then((r) => r.json() as Promise<{ balance: string }>),
    fetch(`${IRYS_DEVNET}/price/solana/${PUBLISH_CEILING_BYTES}`).then((r) => r.text()),
  ])
  return { address, service: IRYS_DEVNET, credits: Number(balance.balance), unit: 'lamports', perRegistration: Number(price) }
}

/**
 * Recarga los creditos de la clave de almacenamiento con `lamports` de SOL.
 * Gasta dinero: solo lo llama un operador, con scripts/storage-credits.ts.
 * Devuelve la firma de la transaccion de pago.
 */
export async function topUpStorageCredits(lamports: number): Promise<string> {
  const address = storageAddress()

  if (SOLANA_NETWORK === 'mainnet-beta') {
    const turbo = TurboFactory.authenticated({
      privateKey: base58.deserialize(readSecret('payer'))[0],
      token: 'solana',
      gatewayUrl: getRpcUrl(),
    })
    const res = await turbo.topUpWithTokens({ tokenAmount: lamports, turboCreditDestinationAddress: address })
    return res.id
  }

  // Irys devnet: la clave de almacenamiento paga a la direccion del nodo y le
  // avisa de la transaccion.
  const storage = Keypair.fromSecretKey(readSecret('storage'))
  const info = (await (await fetch(`${IRYS_DEVNET}/info`)).json()) as { addresses: { solana: string } }
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: storage.publicKey, toPubkey: new PublicKey(info.addresses.solana), lamports })
  )
  const signature = await sendAndConfirmTransaction(getConnection(), tx, [storage])
  const res = await fetch(`${IRYS_DEVNET}/account/balance/solana`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_id: signature }),
  })
  if (!res.ok) throw new Error(`storage credits: Irys devnet did not register ${signature} (${res.status}).`)
  return signature
}
