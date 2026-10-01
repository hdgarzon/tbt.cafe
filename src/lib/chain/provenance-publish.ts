import type { SupabaseClient } from '@supabase/supabase-js'
import { cents } from '@/lib/fees'
import { provenanceRecord, type HolderInput, type ProvenanceEvent, type ProvenanceValue, type RecordRoyalty } from './records'

/**
 * Publicar el registro de procedencia de una fila del historial — Chains 01,
 * Stage 2.3.
 *
 * Un solo sitio que lo compone, a partir de lo que la base ya guarda: la
 * creacion, la transferencia, la restitucion y, con el Stage 7.3, el barrido de
 * recuperacion (d) lo llaman con el id de la fila y nada mas. Asi el registro
 * no depende de lo que cada ruta tuviera a mano en memoria.
 *
 * Idempotente: una fila que ya tiene registro no se vuelve a publicar. Espera
 * —sin lanzar— cuando falta algo que el registro exige: el registro de
 * registración, la firma de Solana (4.5: mover, registrar, anclar) o el
 * eslabon anterior.
 */

export type ProvenanceOutcome =
  | { published: true; uri: string; hash: string }
  | { published: false; reason: 'already' | 'not_found' | 'no_registration' | 'no_signature' | 'no_prior' }

type TransferValue = {
  value_kind: 'declared' | 'gift' | 'sale' | 'restoring' | null
  sale_price: number | null
  payment_amount: number | null
  payment_currency: string | null
}

/** La clase de valor de la transferencia, y el evento que la publica (2.3). */
const EVENT_OF: Record<'sale' | 'declared' | 'gift', ProvenanceEvent> = { sale: 'sale', declared: 'transfer', gift: 'gift' }

export async function publishProvenance(
  admin: SupabaseClient,
  historyId: string,
  opts: { solanaSignature?: string | null } = {}
): Promise<ProvenanceOutcome> {
  const { data: row } = await admin
    .from('ownership_history')
    .select(
      'id, work_id, sequence_number, event_type, transfer_type, price, currency, created_at, holder_code, holder_named, holder_public_name, token_move_signature, record_uri, transfer_id'
    )
    .eq('id', historyId)
    .maybeSingle()
  if (!row) return { published: false, reason: 'not_found' }
  if (row.record_uri) return { published: false, reason: 'already' }

  const { data: work } = await admin
    .from('works')
    .select('tbt_id, registration_record_uri, mint_signature')
    .eq('id', row.work_id)
    .single()
  if (!work?.registration_record_uri || !work.tbt_id) return { published: false, reason: 'no_registration' }

  const sequence: number = row.sequence_number
  const signature = sequence === 1 ? opts.solanaSignature ?? work.mint_signature : row.token_move_signature
  if (!signature) return { published: false, reason: 'no_signature' }

  let priorRecord: string | undefined
  if (sequence > 1) {
    const { data: prior } = await admin
      .from('ownership_history')
      .select('record_hash')
      .eq('work_id', row.work_id)
      .eq('sequence_number', sequence - 1)
      .maybeSingle()
    if (!prior?.record_hash) return { published: false, reason: 'no_prior' }
    priorRecord = prior.record_hash
  }

  // El evento y su valor.
  let event: ProvenanceEvent
  let value: ProvenanceValue
  if (sequence === 1) {
    event = 'creation'
    value = { kind: 'creation' }
  } else if (row.event_type === 'restoring') {
    event = 'restoring'
    value = { kind: 'restoring' }
  } else {
    const { data: transfer } = row.transfer_id
      ? await admin.from('transfers').select('value_kind, sale_price, payment_amount, payment_currency').eq('id', row.transfer_id).maybeSingle()
      : { data: null }
    const t = transfer as TransferValue | null
    // Filas anteriores a 071 no nombran su transferencia: el historial dice venta o regalo.
    const kind = t?.value_kind === 'declared' || t?.value_kind === 'gift' || t?.value_kind === 'sale'
      ? t.value_kind
      : row.transfer_type === 'gift' ? 'gift' : 'sale'
    const currency = String(t?.payment_currency ?? row.currency ?? 'USD').toUpperCase()
    const amount = kind === 'gift' ? 0 : cents(Number((kind === 'sale' ? t?.sale_price ?? t?.payment_amount : t?.payment_amount) ?? row.price ?? 0))
    event = EVENT_OF[kind]
    value = { kind, amount_cents: amount, currency }
  }

  // La regalia, solo en el registro del cambio en que se bloqueo (060 guarda cual).
  let royalty: RecordRoyalty | undefined
  if (sequence > 1) {
    const { data: commerce } = await admin
      .from('work_commerce')
      .select('royalty_type, royalty_value, royalty_locked_by, currency')
      .eq('work_id', row.work_id)
      .maybeSingle()
    if (commerce && commerce.royalty_locked_by === row.id && commerce.royalty_type !== 'none') {
      royalty =
        commerce.royalty_type === 'fixed'
          ? { type: 'fixed', amount_cents: cents(Number(commerce.royalty_value)), currency: String(commerce.currency ?? 'USD').toUpperCase() }
          : { type: 'percentage', basis_points: Math.round(Number(commerce.royalty_value) * 100) }
    }
  }

  // El titular, como eligio en esta adquisicion (3.2).
  const holder: HolderInput = row.holder_named && row.holder_public_name
    ? { name: row.holder_public_name }
    : { privateCollector: row.holder_code }

  const titleNumber = `${work.tbt_id}-${sequence}`
  const { holdingAddress } = await import('@/lib/solana/holding')
  const { publishRecord } = await import('./arweave')

  const published = await publishRecord(
    provenanceRecord({
      tbtId: work.tbt_id,
      sequence,
      titleNumber,
      event,
      holder,
      holdingAddress: holdingAddress(titleNumber).toBase58(),
      value,
      royalty,
      occurredAt: new Date(row.created_at),
      solanaSignature: signature,
      priorRecord,
      registrationRecord: work.registration_record_uri,
    }) as never
  )

  await admin
    .from('ownership_history')
    .update({ record_uri: published.uri, record_hash: published.hash })
    .eq('id', row.id)
    .is('record_uri', null)

  return { published: true, uri: published.uri, hash: published.hash }
}
