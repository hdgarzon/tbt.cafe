import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El ticket de una disputa — Work Order 02, Stage 8.1.
 *
 * Una disputa se guarda como hasta ahora y ademas abre un ticket de sistema en
 * la categoria `dispute`, con la evidencia que la plataforma ya tiene. Mandarla
 * a Stripe es cosa de un operador (§16). Su dinero no cobrado ya queda
 * congelado por la base mientras siga abierta (064). Uno por disputa, y a
 * ningun cliente se le avisa (8.5): es asunto de operaciones.
 *
 * Lo que aun no existe queda en null y dice por que: la aceptacion de los
 * Terminos (0.8b), el acuse de la confirmacion (0.9a) y el 3-D Secure cumplido
 * (0.6) llegan con el Stage 0.
 */
export async function openDisputeTicket(
  db: SupabaseClient,
  d: { providerRef: string; amount: number; currency: string; reason: string | null; status: string; workId: string | null; transferId: string | null; userId: string | null }
): Promise<void> {
  const { data: existing } = await db.from('tickets').select('ref').eq('category', 'dispute').contains('context', { dispute_ref: d.providerRef }).maybeSingle()
  if (existing) return

  const [{ data: work }, { data: title }, { data: history }, { data: transfer }, { data: auth }] = await Promise.all([
    d.workId ? db.from('works').select('tbt_id, title, mint_address, registration_record_uri, registration_record_hash, current_owner_id').eq('id', d.workId).maybeSingle() : Promise.resolve({ data: null }),
    d.workId ? db.from('titles').select('title_number, issued_at').eq('work_id', d.workId).order('issued_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    d.workId ? db.from('ownership_history').select('sequence_number, event_type, record_uri, record_hash, created_at').eq('work_id', d.workId).order('sequence_number', { ascending: true }) : Promise.resolve({ data: null }),
    d.transferId ? db.from('transfers').select('from_owner_id, to_owner_id, transfer_type, value_kind, payment_amount').eq('id', d.transferId).maybeSingle() : Promise.resolve({ data: null }),
    d.userId && d.workId ? db.from('money_action_auth').select('action, satisfied_biometric, required_three_ds, created_at').eq('user_id', d.userId).eq('work_id', d.workId).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const w = work as { tbt_id?: string; title?: string; mint_address?: string | null; registration_record_uri?: string | null; registration_record_hash?: string | null } | null
  await db.from('tickets').insert({
    origin: 'system',
    category: 'dispute',
    severity: 'primary',
    subject: `Dispute ${d.providerRef} — ${w?.title ?? 'unresolved work'} ${w?.tbt_id ?? ''}`.trim(),
    body: `A ${d.amount} ${d.currency.toUpperCase()} dispute (${d.reason ?? 'no reason'}), status ${d.status}.`,
    subject_user: d.userId,
    context: {
      kind: 'dispute',
      dispute_ref: d.providerRef,
      amount: d.amount,
      currency: d.currency,
      reason: d.reason,
      work_id: d.workId,
      transfer_id: d.transferId,
      parties: transfer ? { from: (transfer as { from_owner_id?: string }).from_owner_id, to: (transfer as { to_owner_id?: string }).to_owner_id } : null,
      path: (transfer as { transfer_type?: string } | null)?.transfer_type ?? null,
      evidence: {
        title_number: (title as { title_number?: string } | null)?.title_number ?? null,
        issued_at: (title as { issued_at?: string } | null)?.issued_at ?? null,
        registration: w ? { record_uri: w.registration_record_uri ?? null, record_hash: w.registration_record_hash ?? null, mint_address: w.mint_address ?? null } : null,
        provenance: history ?? [],
        satisfied_biometric: (auth as { satisfied_biometric?: boolean } | null)?.satisfied_biometric ?? null,
        satisfied_three_ds: null,
        terms_acceptance: null,
        confirmation_acknowledged: null,
        pending_from_stage_0: ['satisfied_three_ds', 'terms_acceptance', 'confirmation_acknowledged'],
      },
    },
  })
}
