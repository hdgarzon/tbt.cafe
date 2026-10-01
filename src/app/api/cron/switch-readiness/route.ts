import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { createAdminClient } from '@/lib/supabase-admin'
import { SOLANA_NETWORK, getConnection } from '@/lib/solana/config'
import { KEY_ENV, readSecret, assertDistinctSecrets, type KeyRole } from '@/lib/solana/keys'

/**
 * GET /api/cron/switch-readiness — ¿esta produccion lista para el cambio?
 * Work Order Chains 01, Stage 11.1 y 11.4.
 *
 * Solo lee. Dice que esta puesto y que falta: red, conexion de pago, las cuatro
 * claves (por su direccion publica, nunca el secreto), la coleccion en cadena,
 * el saldo de trabajo del payer, los datos de prueba borrados y los IDs
 * reservados. No cambia nada; el cambio lo hacen personas, con el runbook
 * (documentation/mainnet-switch.md).
 */
export const dynamic = 'force-dynamic'

/** El programa de Metaplex Core: la coleccion es una cuenta suya. */
const MPL_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
/** C11: un saldo de trabajo de 1–2 SOL antes del cambio. */
const WORKING_BALANCE_LAMPORTS = 1_000_000_000

type Check = { name: string; ok: boolean; detail?: string }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }

  const checks: Check[] = []
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) })

  push('network is mainnet-beta', SOLANA_NETWORK === 'mainnet-beta', SOLANA_NETWORK)
  push('paid RPC configured (SOLANA_RPC_URL)', Boolean(process.env.SOLANA_RPC_URL))

  // Las cuatro claves: presentes y distintas. Se informa la direccion publica.
  const secrets: Partial<Record<KeyRole, Uint8Array>> = {}
  const addresses: Partial<Record<KeyRole, string>> = {}
  const roles = Object.keys(KEY_ENV) as KeyRole[]
  for (let i = 0; i < roles.length; i++) {
    try {
      const bytes = readSecret(roles[i])
      secrets[roles[i]] = bytes
      addresses[roles[i]] = new PublicKey(bytes.slice(32, 64)).toBase58()
      push(`${KEY_ENV[roles[i]]} configured`, true, addresses[roles[i]])
    } catch {
      push(`${KEY_ENV[roles[i]]} configured`, false)
    }
  }
  try {
    assertDistinctSecrets(secrets)
    push('the four keys are distinct', Object.keys(secrets).length === roles.length)
  } catch {
    push('the four keys are distinct', false)
  }
  push('title-signing key ID set (TBT_TITLE_SIGNING_KEY_ID)', Boolean(process.env.TBT_TITLE_SIGNING_KEY_ID))
  push('CRON_SECRET set', true)

  // La coleccion y el saldo, en la red configurada.
  const connection = (() => {
    try {
      return getConnection()
    } catch {
      return null
    }
  })()
  const collection = process.env.TBT_COLLECTION_ADDRESS
  if (!collection) push('collection created (TBT_COLLECTION_ADDRESS)', false)
  else if (connection) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(collection))
      push('collection exists as a Core account', info?.owner.toBase58() === MPL_CORE_PROGRAM, collection)
    } catch (error) {
      push('collection exists as a Core account', false, error instanceof Error ? error.message : 'lookup failed')
    }
  }
  if (addresses.payer && connection) {
    try {
      const lamports = await connection.getBalance(new PublicKey(addresses.payer))
      push('payer holds the working balance (1 SOL)', lamports >= WORKING_BALANCE_LAMPORTS, `${lamports / 1e9} SOL`)
    } catch (error) {
      push('payer holds the working balance (1 SOL)', false, error instanceof Error ? error.message : 'lookup failed')
    }
  }

  // La base: los datos de prueba borrados (Stage 10) y los IDs reservados.
  const admin = createAdminClient()
  const [{ count: works }, { count: vectors }, { data: config }] = await Promise.all([
    admin.from('works').select('id', { count: 'exact', head: true }),
    admin.from('image_vectors').select('work_id', { count: 'exact', head: true }),
    admin.from('platform_config').select('tbt_id_reserved').eq('id', true).maybeSingle(),
  ])
  push('test works deleted (Stage 10)', works === 0, `${works ?? '?'} works`)
  push('originality index empty (Stage 10)', vectors === 0, `${vectors ?? '?'} vectors`)
  const reserved = ((config as { tbt_id_reserved?: string[] } | null)?.tbt_id_reserved ?? []).length
  push('prototype IDs reserved', reserved >= 8, `${reserved} reserved`)

  return NextResponse.json({ ready: checks.every((c) => c.ok), checks })
}
