import { supabase } from '@/lib/supabase'

/**
 * Capa de datos de Ofertas (Build Spec 02, Ítem 5, migración 009) — ledger
 * ligero para que una oferta sobre una obra en venta y una aproximación no
 * solicitada sobre una obra que no está en venta queden ambas registradas.
 */

export type OfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'cancelled' | 'completed'

export type MyOffer = {
  id: string
  work_id: string
  work_title: string
  work_tbt_id: string
  amount: number
  currency: string
  status: OfferStatus
  solicited: boolean
  created_at: string
}

/**
 * Envía una oferta por /api/offers (Work Order 02, 4.2): el navegador ya no
 * escribe `offers` (061). La duracion y el mensaje son opcionales.
 */
export async function makeOffer(
  workId: string,
  amount: number,
  _solicited?: boolean,
  opts: { durationHours?: number; message?: string } = {}
): Promise<{ error?: string; floor?: number; id?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { error: 'needSignIn' }
  const res = await fetch('/api/offers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workId, amount, durationHours: opts.durationHours, message: opts.message }),
  })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { id: json.id } : { error: json.error ?? 'offer_failed', floor: json.floor }
}

/** Una accion sobre una oferta: accept, decline, withdraw, cancel o report. */
export async function actOnOffer(
  offerId: string,
  action: 'accept' | 'decline' | 'withdraw' | 'cancel' | 'report',
  opts: { reply?: string; which?: 'message' | 'response' } = {}
): Promise<{ error?: string; ref?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { error: 'needSignIn' }
  const res = await fetch(`/api/offers/${offerId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...opts }),
  })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { ref: json.ref } : { error: json.error ?? 'offer_failed' }
}

/** Ofertas hechas por el usuario actual, más recientes primero. */
export async function fetchMyOffers(): Promise<MyOffer[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('offers')
    .select('id, work_id, amount, currency, status, solicited, created_at, work:works(title, tbt_id)')
    .eq('from_user', user.id)
    .order('created_at', { ascending: false })

  return (data ?? []).map((o) => {
    const work = Array.isArray(o.work) ? o.work[0] : o.work
    return {
      id: o.id,
      work_id: o.work_id,
      work_title: work?.title ?? '',
      work_tbt_id: work?.tbt_id ?? '',
      amount: Number(o.amount),
      currency: o.currency,
      status: o.status as OfferStatus,
      solicited: o.solicited,
      created_at: o.created_at,
    }
  })
}

/** La oferta vista por una de sus dos partes — /api/offers/[id] (4.12). */
export type OfferDetail = {
  id: string
  role: 'holder' | 'offerer'
  work: { title: string; tbtId: string }
  counterparty: string | null
  amount: number
  status: OfferStatus
  suspended: boolean
  durationHours: number
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  paymentDueAt: string | null
  autoCancelAt: string | null
  closedAt: string | null
  closeReason: string | null
  message: string | null
  responseMessage: string | null
  holderApproved: boolean
  payAvailable: boolean
}

export async function fetchOffer(offerId: string): Promise<OfferDetail | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null
  const res = await fetch(`/api/offers/${offerId}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  return res.ok ? ((await res.json()) as OfferDetail) : null
}

/** Lo que se avisa antes de ofertar (S-2, sin cobertura) y si la obra esta congelada. */
export async function fetchOfferContext(
  workId: string
): Promise<{ holderApproved: boolean; holderCovered: boolean; frozenUntil: string | null } | null> {
  const res = await fetch(`/api/offers?workId=${encodeURIComponent(workId)}`)
  return res.ok ? await res.json() : null
}
