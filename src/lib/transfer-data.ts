import { supabase } from '@/lib/supabase'
import { TBT_BACKEND_URL } from '@/lib/backend'

/**
 * Capa de datos de transferencia de dos fases (Build Spec 02 / Transfer &
 * Commerce Companion) — mapea sobre la tabla `transfers` que YA existe en el
 * backend (mismo proyecto Supabase que Forms), extendida por la migración
 * 004_two_phase_transfer.sql (repo Forms) con is_two_phase,
 * stripe_payment_intent_id, authorized_at y outcome.
 *
 * IMPORTANTE — esto NO es lo mismo que el flujo legacy de /transferir en
 * Forms (pago único, se cobra al instante). Aquí:
 *   1. createTransfer      -> fila is_two_phase=true, payment_status='pending';
 *                             autoriza la tarjeta (Stripe manual-capture) vía
 *                             POST /api/transfer/create en el backend
 *   2. (recipiente acepta) -> respondTransfer('accept') -> POST
 *                             /api/transfer/respond: captura + escribe cadena
 *                             + mueve propiedad -> payment_status='completed'
 *   2. (rechaza/vence)     -> respondTransfer('reject') -> libera la
 *                             retención, nunca cobra
 *   (el emisor puede)      -> cancelTransfer -> libera la retención
 *
 * El dinero se AUTORIZA al enviar y se CAPTURA solo al aceptar. Todas las
 * mutaciones (crear/cancelar/responder) pasan por el backend — nunca se
 * escribe esta tabla directamente desde el cliente, porque cada paso también
 * toca Stripe. Los `select` de lectura sí van directo a Supabase (RLS
 * own-row: from_owner_id = auth.uid() OR to_owner_id = auth.uid()).
 */

export type TransferOutcome = 'accepted' | 'rejected' | 'lapsed' | 'cancelled'

export type Transfer = {
  id: string
  work_id: string
  from_owner_id: string
  to_owner_id: string | null
  new_owner_name: string | null
  new_owner_phone: string | null
  payment_amount: number | null
  payment_currency: string
  payment_status: string
  outcome: TransferOutcome | null
  authorized_at: string | null
  created_at: string
  completed_at: string | null
}

export type CreateTransferInput = {
  workId: string
  recipientPhone: string // E.164, +12035551234
  recipientName: string
  value: number
  /** Prueba biométrica cuando la escalera la exige (Spec 01 §5.1). */
  biometricProof?: string | null
}

async function authHeader(): Promise<{ Authorization: string } | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : null
}

/**
 * Fase 1 — crea la transferencia y autoriza el pago vía el backend. Pide al
 * backend que redirija de vuelta a ESTE origen (tbt.cafe) — el backend valida
 * que successUrl/cancelUrl estén en su propia allowlist de CORS.
 */
export async function createTransfer(input: CreateTransferInput): Promise<{ checkoutUrl?: string; error?: string }> {
  const auth = await authHeader()
  if (!auth) return { error: 'needSignIn' }

  const origin = window.location.origin
  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/transfer/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        workId: input.workId,
        recipientPhone: input.recipientPhone,
        recipientName: input.recipientName,
        value: input.value,
        biometricProof: input.biometricProof ?? null,
        successUrl: `${origin}/work/${input.workId}?transfer=sent`,
        cancelUrl: `${origin}/work/${input.workId}?transfer=cancelled`,
      }),
    })
    const body = await res.json()
    if (!res.ok) return { error: body.error ?? 'transferFailed' }
    return { checkoutUrl: body.checkoutUrl }
  } catch {
    return { error: 'transferFailed' }
  }
}

/** Transferencia de dos fases abierta (autorizándose o pendiente) para una obra — pinta el estado del Action tab. */
export async function pendingTransferFor(workId: string, userId: string): Promise<Transfer | null> {
  const { data } = await supabase
    .from('transfers')
    .select(
      'id, work_id, from_owner_id, to_owner_id, new_owner_name, new_owner_phone, payment_amount, payment_currency, payment_status, outcome, authorized_at, created_at, completed_at'
    )
    .eq('work_id', workId)
    .eq('from_owner_id', userId)
    .eq('is_two_phase', true)
    .eq('payment_status', 'pending')
    .is('outcome', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as Transfer | null) ?? null
}

/** El emisor cancela una transferencia pendiente — libera el hold, nunca cobra. */
export async function cancelTransfer(transferId: string): Promise<{ error?: string }> {
  const auth = await authHeader()
  if (!auth) return { error: 'needSignIn' }

  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/transfer/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ transferId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: body.error ?? 'cancelFailed' }
    }
    return {}
  } catch {
    return { error: 'cancelFailed' }
  }
}

export type TransferForAccept = {
  id: string
  status: 'pending' | 'authorizing' | TransferOutcome
  workTitle: string
  workMediaUrl: string | null
  senderName: string | null
  value: number | null
  currency: string
}

/**
 * Carga los datos públicos de una transferencia para la vista de aceptar
 * (link por SMS, ANTES de que el recipiente inicie sesión) — vía el backend,
 * no un select directo: la fila puede no pertenecer todavía a ningún usuario
 * autenticado (to_owner_id es NULL hasta el accept), así que RLS own-row no
 * aplicaría. El backend devuelve solo el subconjunto seguro de campos.
 */
export async function fetchTransferForAccept(transferId: string): Promise<TransferForAccept | null> {
  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/transfer/${transferId}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Fase 2 — el recipiente responde. 'accept' captura el pago, escribe la
 * cadena y mueve la propiedad (server-side); 'reject' libera el hold. Ambas
 * ramas notifican a las dos partes. Requiere sesión — la vista de aceptar
 * crea autenticación inline si el recipiente no tiene cuenta aún.
 */
export async function respondTransfer(
  transferId: string,
  action: 'accept' | 'reject'
): Promise<{ error?: string }> {
  const auth = await authHeader()
  if (!auth) return { error: 'needSignIn' }

  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/transfer/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ transferId, action }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: body.error ?? 'respondFailed' }
    }
    return {}
  } catch {
    return { error: 'respondFailed' }
  }
}
