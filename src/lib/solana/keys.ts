import { PublicKey } from '@solana/web3.js'
import { base58 } from '@metaplex-foundation/umi/serializers'

/**
 * Las cuatro claves — Chains 01, Stage 7.1.
 *
 * Una variable por clave y un trabajo por clave:
 *  - payer: tiene SOL, paga comisiones y recarga Turbo. Reemplazable.
 *  - authority: autoridad de la coleccion y delegado permanente. Firma
 *    acunaciones, movimientos y repunteos. Perderla es no poder mover tokens.
 *  - storage: firma cada subida a Arweave; es la identidad de tbt.cafe alli.
 *  - titleSigning: Ed25519, firma cada archivo de titulo atado.
 *
 * Solo en Production. Las tres con respaldo offline se niegan en un preview:
 * si la variable llegara a estar alli, un preview podria firmar como tbt.cafe.
 * Nada de esto lee el entorno al importar (check:boot).
 */
export const KEY_ENV = {
  payer: 'SOLANA_PAYER_PRIVATE_KEY',
  authority: 'SOLANA_AUTHORITY_PRIVATE_KEY',
  storage: 'TBT_STORAGE_PRIVATE_KEY',
  titleSigning: 'TBT_TITLE_SIGNING_PRIVATE_KEY',
} as const

export type KeyRole = keyof typeof KEY_ENV

const PRODUCTION_ONLY: KeyRole[] = ['authority', 'storage', 'titleSigning']

/**
 * Lo que cuesta una acunacion en Core, con margen — Stage 7.2.3.
 *
 * Medido en devnet el 29 sep 2026: 2 749 440 lamports (renta del activo mas la
 * comision). El doble, porque la renta crece con la URI y el nombre.
 */
export const MIN_LAMPORTS_FOR_MINT = 5_000_000

/** La clave secreta de un papel, como arreglo JSON o base58. */
export function readSecret(role: KeyRole): Uint8Array {
  if (PRODUCTION_ONLY.indexOf(role) !== -1 && process.env.VERCEL_ENV === 'preview') {
    throw new Error(`${KEY_ENV[role]} is production only; refusing to sign in a preview deployment.`)
  }
  const raw = process.env[KEY_ENV[role]]
  if (!raw) throw new Error(`${KEY_ENV[role]} not configured`)
  try {
    return Uint8Array.from(JSON.parse(raw))
  } catch {
    return base58.serialize(raw)
  }
}

/** Una clave con dos trabajos no es dos claves: se niega. */
export function assertDistinctSecrets(secrets: Partial<Record<KeyRole, string | Uint8Array>>): void {
  const seen: string[] = []
  const roles = Object.keys(secrets) as KeyRole[]
  for (let i = 0; i < roles.length; i++) {
    const v = secrets[roles[i]]
    if (!v) continue
    const bytes = typeof v === 'string' ? Uint8Array.from(JSON.parse(v)) : v
    const pub = new PublicKey(bytes.slice(32, 64)).toBase58()
    if (seen.indexOf(pub) !== -1) throw new Error(`${KEY_ENV[roles[i]]} is the same key as another role; each key has one job.`)
    seen.push(pub)
  }
}

/** Se niega a acunar si el payer no alcanza para una: la obra espera al barrido. */
export function assertPayerCanMint(lamports: number | bigint): void {
  if (Number(lamports) < MIN_LAMPORTS_FOR_MINT) {
    throw new Error(`payer_balance_low: ${Number(lamports)} lamports, a mint needs ${MIN_LAMPORTS_FOR_MINT}. Not attempted; the work waits for the sweep.`)
  }
}
