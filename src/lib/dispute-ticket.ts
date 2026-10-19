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
 * La evidencia lleva lo que el Stage 0 guarda: la aceptacion de los Terms
 * (0.8b), el acuse de la confirmacion (0.9a) y el 3-D Secure cumplido (0.6d).
 * Y desde la decision 94 (Amendment Delivery 01), la entrega de la venta: lo que
 * eligio el comprador, su reconocimiento, y los datos del vendedor con su hora.
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
    d.transferId ? db.from('transfers').select('from_owner_id, to_owner_id, transfer_type, value_kind, payment_amount, confirmation_acknowledged_at').eq('id', d.transferId).maybeSingle() : Promise.resolve({ data: null }),
    d.userId && d.workId ? db.from('money_action_auth').select('action, satisfied_biometric, required_three_ds, satisfied_three_ds, created_at').eq('user_id', d.userId).eq('work_id', d.workId).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const w = work as { tbt_id?: string; title?: string; mint_address?: string | null; registration_record_uri?: string | null; registration_record_hash?: string | null } | null

  // Lo del comprador: los Terms, el reconocimiento de entrega y la entrega misma.
  const buyerId = (transfer as { to_owner_id?: string } | null)?.to_owner_id ?? null
  const [{ data: terms }, { data: deliveryAck }, { data: saleDelivery }] = await Promise.all([
    buyerId ? db.from('terms_acceptances').select('terms_version, accepted_at, transfer_id').eq('user_id', buyerId).eq('kind', 'terms').order('accepted_at', { ascending: true }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    buyerId ? db.from('terms_acceptances').select('terms_version, accepted_at').eq('user_id', buyerId).eq('kind', 'buyer_delivery').order('accepted_at', { ascending: true }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    d.transferId ? db.from('sale_deliveries').select('work_kind, choice, address, address_consent_at, details_kind, details, details_submitted_at').eq('transfer_id', d.transferId).maybeSingle() : Promise.resolve({ data: null }),
  ])
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
        satisfied_three_ds: (auth as { satisfied_three_ds?: boolean | null } | null)?.satisfied_three_ds ?? null,
        terms_acceptance: terms ?? null,
        confirmation_acknowledged: (transfer as { confirmation_acknowledged_at?: string | null } | null)?.confirmation_acknowledged_at ?? null,
        // Decision 94: la entrega. tbt.cafe no responde por la obra fisica, pero
        // lo que se eligio y lo que el vendedor dijo, con su hora, es evidencia.
        delivery: saleDelivery
          ? {
              work_kind: (saleDelivery as { work_kind?: string }).work_kind ?? null,
              choice: (saleDelivery as { choice?: string }).choice ?? null,
              address: (saleDelivery as { address?: unknown }).address ?? null,
              address_consent_at: (saleDelivery as { address_consent_at?: string | null }).address_consent_at ?? null,
              details_kind: (saleDelivery as { details_kind?: string | null }).details_kind ?? null,
              details: (saleDelivery as { details?: unknown }).details ?? null,
              details_submitted_at: (saleDelivery as { details_submitted_at?: string | null }).details_submitted_at ?? null,
            }
          : null,
        delivery_acknowledgment: deliveryAck ?? null,
      },
    },
  })
}
