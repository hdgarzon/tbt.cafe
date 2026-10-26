import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { SOLANA_NETWORK, getConnection } from '@/lib/solana/config'
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
 *
 * Turbo se llama por HTTP, igual que su SDK pero sin el (storage-upload.ts dice
 * por que).
 */

const IRYS_DEVNET = UPLOAD_SERVICE.devnet
const TURBO_PAYMENT = 'https://payment.ardrive.io'
/** El programa Memo de Solana: Turbo acredita a la direccion que nombra el memo. */
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

export type StorageCredits = {
  address: string
  service: string
  credits: number
  unit: 'winc' | 'lamports'
  perRegistration: number
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`storage credits: ${url} answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

/** Le avisa al servicio de la transaccion de pago, para que la acredite. */
async function registerPayment(url: string, signature: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_id: signature }),
  })
  if (!res.ok) throw new Error(`storage credits: ${url} did not register ${signature} (${res.status}).`)
}

export async function storageCredits(): Promise<StorageCredits> {
  const address = storageAddress()

  if (SOLANA_NETWORK === 'mainnet-beta') {
    // Una direccion que nunca recargo no tiene cuenta: Turbo contesta 404, y eso es cero.
    const balance = await fetch(`${TURBO_PAYMENT}/v1/account/balance/solana?address=${address}`)
    if (!balance.ok && balance.status !== 404) throw new Error(`storage credits: Turbo balance answered ${balance.status}`)
    const winc = balance.ok ? ((await balance.json()) as { winc: string }).winc : '0'
    const price = await json<{ winc: string }>(`${TURBO_PAYMENT}/v1/price/bytes/${PUBLISH_CEILING_BYTES}`)
    return { address, service: UPLOAD_SERVICE['mainnet-beta'], credits: Number(winc), unit: 'winc', perRegistration: Number(price.winc) }
  }

  const [balance, price] = await Promise.all([
    json<{ balance: string }>(`${IRYS_DEVNET}/account/balance/solana?address=${address}`),
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
    // El payer paga a la direccion de Turbo y el memo dice a quien acreditar;
    // despues se le avisa a Turbo de la transaccion. Es lo que hace su SDK.
    const payer = Keypair.fromSecretKey(readSecret('payer'))
    const info = await json<{ addresses: { solana: string } }>(`${TURBO_PAYMENT}/v1/info`)
    const tx = new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(info.addresses.solana), lamports }))
      .add(new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM),
        keys: [],
        data: Buffer.from('turboCreditDestinationAddress=' + address),
      }))
    const signature = await sendAndConfirmTransaction(getConnection(), tx, [payer])
    await registerPayment(`${TURBO_PAYMENT}/v1/account/balance/solana`, signature)
    return signature
  }

  // Irys devnet: la clave de almacenamiento paga a la direccion del nodo y le
  // avisa de la transaccion.
  const storage = Keypair.fromSecretKey(readSecret('storage'))
  const info = await json<{ addresses: { solana: string } }>(`${IRYS_DEVNET}/info`)
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: storage.publicKey, toPubkey: new PublicKey(info.addresses.solana), lamports })
  )
  const signature = await sendAndConfirmTransaction(getConnection(), tx, [storage])
  await registerPayment(`${IRYS_DEVNET}/account/balance/solana`, signature)
  return signature
}
