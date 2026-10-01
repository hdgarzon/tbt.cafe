import type { SupabaseClient } from '@supabase/supabase-js'
import { moveTokenForOwnership } from '@/lib/token-move'

/**
 * La restitucion — Work Order 02, Stage 8.4 (57).
 *
 * Un reembolso o una disputa perdida devuelve la obra a quien la vendio. La
 * propiedad nunca se revierte: se escribe una fila NUEVA de historial, con su
 * indice y su codigo de titular (062), y la obra vuelve al vendedor. La regalia
 * no se toca: el bloqueo sigue (060) y la restitucion no genera otra
 * (recordRoyaltyEarning vuelve antes). El historial dice «Returned to seller».
 *
 * La llaman el reembolso (8.2) y la disputa perdida (8.3), que llegan con el
 * Stage 0. El titulo de restitucion se emite aqui en cuanto su etiqueta en la
 * cara este decidida (pregunta c a Federico): hoy no existe ninguna.
 *
 * Idempotente por la transferencia que se deshace.
 */
export async function restoreToSeller(
  db: SupabaseClient,
  p: { transferId: string; reason: 'refund' | 'dispute_lost' }
): Promise<{ restored: boolean; historyId?: string }> {
  const { data: t } = await db.from('transfers').select('id, work_id, from_owner_id, from_owner_name').eq('id', p.transferId).maybeSingle()
  if (!t) return { restored: false }

  const { data: already } = await db
    .from('ownership_history')
    .select('id')
    .eq('work_id', t.work_id)
    .eq('event_type', 'restoring')
    .eq('owner_user_id', t.from_owner_id)
    .contains('restoring_of', [p.transferId])
    .maybeSingle()
  if (already) return { restored: false, historyId: already.id }

  const { count } = await db.from('ownership_history').select('id', { count: 'exact', head: true }).eq('work_id', t.work_id)
  const { data: seller } = await db.from('profiles').select('public_alias, display_name').eq('id', t.from_owner_id).maybeSingle()
  const name = seller?.public_alias || seller?.display_name || t.from_owner_name || 'Unknown'

  const { data: row, error } = await db
    .from('ownership_history')
    .insert({
      work_id: t.work_id,
      owner_name: name,
      owner_user_id: t.from_owner_id,
      event_type: 'restoring',
      transfer_type: 'restoring',
      sequence_number: (count ?? 0) + 1,
      restoring_of: [p.transferId],
    })
    .select('id')
    .single()
  if (error || !row) return { restored: false }

  await db.from('works').update({ current_owner_id: t.from_owner_id }).eq('id', t.work_id)

  // Chains 01 4.5: el token vuelve a la tenencia nueva del vendedor.
  const { data: work } = await db.from('works').select('tbt_id').eq('id', t.work_id).maybeSingle()
  if (work?.tbt_id) {
    const signature = await moveTokenForOwnership(db, {
      workId: t.work_id,
      tbtId: work.tbt_id,
      fromSequence: count ?? 0,
      toSequence: (count ?? 0) + 1,
      historyId: row.id,
    })
    // Chains 01 2.3: la restitucion tambien es un eslabon; espera a la firma.
    if (signature) {
      try {
        const { publishProvenance } = await import('@/lib/chain/provenance-publish')
        await publishProvenance(db, row.id)
      } catch (error) {
        console.error('[chain] no se pudo publicar la restitucion:', error)
      }
    }
  }
  return { restored: true, historyId: row.id }
}
