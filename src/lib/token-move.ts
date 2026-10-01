import type { SupabaseClient } from '@supabase/supabase-js'
import { recordProviderEvent } from '@/lib/provider-events'

/**
 * Mover el token en un cambio de dueno — Chains 01, Stage 4.5.
 *
 * La unica funcion que lo hace: la llaman la aceptacion de una transferencia,
 * la restitucion y, con el Stage 0, completeSale. Mueve el activo de la
 * tenencia del numero de titulo anterior (`<TBT ID>-<indice>`) a la del nuevo,
 * firmado por la autoridad como delegado permanente, y guarda la firma en la
 * fila del historial. Nunca lanza: la propiedad ya cambio en el registro; un
 * movimiento fallido lo reintenta el barrido, y la procedencia espera la firma.
 */
export async function moveTokenForOwnership(
  db: SupabaseClient,
  p: { workId: string; tbtId: string; fromSequence: number; toSequence: number; historyId: string }
): Promise<string | null> {
  const { data: work } = await db.from('works').select('mint_address').eq('id', p.workId).maybeSingle()
  if (!work?.mint_address) return null

  const started = Date.now()
  try {
    const { moveTitleToken } = await import('@/lib/solana/token')
    const { signature } = await moveTitleToken(work.mint_address, `${p.tbtId}-${p.fromSequence}`, `${p.tbtId}-${p.toSequence}`)
    await db
      .from('ownership_history')
      .update({ token_move_signature: signature, token_moved_at: new Date().toISOString() })
      .eq('id', p.historyId)
    await recordProviderEvent({ provider: 'solana', operation: 'move_title_token', ok: true, entityType: 'work', entityId: p.workId, latencyMs: Date.now() - started })
    return signature
  } catch (error) {
    await recordProviderEvent({ provider: 'solana', operation: 'move_title_token', ok: false, error, entityType: 'work', entityId: p.workId, latencyMs: Date.now() - started })
    return null
  }
}
