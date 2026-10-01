import type { SupabaseClient } from '@supabase/supabase-js'
import { fromBytea } from './ots'
import { arweaveId, proofRecord } from './records'

/**
 * Publicar las pruebas confirmadas — Chains 01, 6.3.
 *
 * Cada ancla confirmada sin registro de prueba se publica: la prueba .ots
 * completa, en base64, junto al registro que ancla. Es lo que deja comprobar el
 * ancla cuando tbt.cafe ya no exista. Lo llama la corrida de upgrade, despues de
 * confirmar; una prueba que fallo al subir se recoge en la siguiente.
 *
 * Una prueba no se ancla a su vez (publishRecord la salta), y una que ya tiene
 * su ID no se vuelve a subir.
 */

const BATCH = 25

export async function publishProofs(admin: SupabaseClient): Promise<{ published: number; failed: number }> {
  const { data: rows } = await admin
    .from('chain_anchors')
    .select('record_hash, record_uri, tbt_id, ots_proof, block_height, attested_at')
    .eq('status', 'confirmed')
    .is('proof_record_id', null)
    .not('record_uri', 'is', null)
    .not('tbt_id', 'is', null)
    .order('attested_at', { ascending: true })
    .limit(BATCH)

  const { publishRecord } = await import('./arweave')
  let done = 0
  let failed = 0

  for (const row of rows ?? []) {
    try {
      const record = proofRecord({
        tbtId: row.tbt_id,
        recordHash: row.record_hash,
        recordId: row.record_uri,
        otsProof: fromBytea(row.ots_proof as unknown as string),
        blockHeight: row.block_height,
        attestedAt: new Date(row.attested_at),
      })
      const published = await publishRecord(record as never)
      await admin
        .from('chain_anchors')
        .update({ proof_record_id: arweaveId(published.uri) })
        .eq('record_hash', row.record_hash)
        .is('proof_record_id', null)
      done++
    } catch (error) {
      console.error(`[proof] ${String(row.record_hash).slice(0, 16)}…:`, error)
      failed++
    }
  }
  return { published: done, failed }
}
