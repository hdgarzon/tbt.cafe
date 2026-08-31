import { supabase } from '@/lib/supabase'
import type { Royalty, RoyaltyType } from '@/lib/fees'

/**
 * Capa de datos de la obra — todo lo que /work/[tbtId] necesita leer y
 * escribir.
 *
 * Reemplaza el fetch mínimo del work page de Build Spec 01 con el registro
 * completo de cuatro pestañas (Build Spec 02, ÍTEM 1). Lee `works`,
 * `work_commerce` (extendido en la migración 008), `work_series` (006) y
 * `ownership_history`. El botón Buy sigue llamando la ruta Stripe existente
 * del backend — esta capa no toca el pago.
 */

export type Availability = 'for_sale' | 'reserved' | 'not_for_sale'

export type WorkCommerce = {
  initial_price: number | null
  currency: string
  availability: Availability
  taking_offers: boolean
  /** 'none' | 'percentage' | 'fixed' — una regalía fija es absoluta (Spec 01 §2.1). */
  royalty_type: RoyaltyType
  /** El porcentaje o el monto fijo, según `royalty_type`. */
  royalty_value: number
  royalty_locked: boolean
}

/** Los términos de regalía de la obra, en la forma que espera `@/lib/fees`. */
export function royaltyOf(c: WorkCommerce | null): Royalty {
  if (!c) return { type: 'none', value: 0 }
  return { type: c.royalty_type, value: c.royalty_value }
}

export type WorkFull = {
  id: string
  tbt_id: string
  title: string
  description: string | null
  category: string | null
  technique: string | null
  media_url: string | null
  status: string
  certified_at: string | null
  mint_address: string | null
  is_featured: boolean
  current_owner_id: string
  creator_id: string
  series: { id: string; name: string; slug: string } | null
  creator: { id: string; public_alias: string | null; display_name: string | null } | null
  commerce: WorkCommerce | null
  /** Pasaje de contexto generado al certificar (Spec 01) — user_edited_summary si existe, si no ai_summary. */
  context: string | null
}

const COMMERCE_DEFAULT: WorkCommerce = {
  initial_price: null,
  currency: 'USD',
  availability: 'not_for_sale',
  taking_offers: false,
  royalty_type: 'percentage',
  royalty_value: 10,
  royalty_locked: false,
}

/** Carga completa de una obra por su TBT-ID canónico. */
export async function fetchWorkFull(tbtId: string): Promise<WorkFull | null> {
  const { data, error } = await supabase
    .from('works')
    .select(
      `id, tbt_id, title, description, category, technique, media_url, status,
       certified_at, mint_address, is_featured, current_owner_id, creator_id,
       series:work_series(id, name, slug),
       creator:profiles!works_creator_id_fkey(id, public_alias, display_name),
       commerce:work_commerce(initial_price, currency, availability, taking_offers, royalty_type, royalty_value, royalty_locked),
       context:context_snapshots(ai_summary, user_edited_summary)`
    )
    .eq('tbt_id', tbtId)
    .single()

  if (error || !data) return null

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  const ctx = one(data.context as { ai_summary: string | null; user_edited_summary: string | null } | { ai_summary: string | null; user_edited_summary: string | null }[] | null)

  return {
    ...data,
    series: one(data.series),
    creator: one(data.creator),
    commerce: one(data.commerce) ?? COMMERCE_DEFAULT,
    context: ctx?.user_edited_summary || ctx?.ai_summary || null,
  } as WorkFull
}

/** Rol del usuario actual respecto a la obra — determina si ve la pestaña Action. */
export function ownerRole(work: WorkFull, userId: string | null): 'creator' | 'collector' | null {
  if (!userId) return null
  if (work.creator_id === userId) return 'creator'
  if (work.current_owner_id === userId) return 'collector'
  return null
}

export type OwnershipEvent = {
  id: string
  event: string
  actor_label: string | null
  amount: number | null
  currency: string | null
  occurred_at: string
}

/* ── El libro de la obra ──────────────────────────────────────────────────── */

export type LedgerAnchor = {
  status: 'pending' | 'confirmed' | 'failed'
  blockHeight: number | null
  attestedAt: string | null
}

export type LedgerEntry = {
  id?: string
  sequence: number
  event?: string
  transferType?: string | null
  actor?: string | null
  from?: string | null
  occurredAt: string | null
  recordUri: string | null
  recordHash: string | null
  anchor: LedgerAnchor | null
}

export type Ledger = {
  tbtId: string
  mintAddress: string | null
  registration: LedgerEntry | null
  provenance: LedgerEntry[]
}

/**
 * El libro: registros publicados y su ancla.
 *
 * Pasa por una ruta y no por Supabase directo porque `chain_anchors` es de
 * service role: sin politicas de lectura, y abrirla entera dejaria enumerar
 * las anclas de todo el sistema.
 */
export async function fetchLedger(tbtId: string): Promise<Ledger | null> {
  try {
    const res = await fetch(`/api/work/${encodeURIComponent(tbtId)}/ledger`)
    if (!res.ok) return null
    return (await res.json()) as Ledger
  } catch {
    return null
  }
}

/** Historial de propiedad, más reciente primero — alimenta la pestaña History. */
export async function fetchOwnershipHistory(workId: string): Promise<OwnershipEvent[]> {
  const { data } = await supabase
    .from('ownership_history')
    .select('id, event_type, owner_name, previous_owner_name, price, currency, created_at')
    .eq('work_id', workId)
    .order('sequence_number', { ascending: false })

  return (data ?? []).map((e) => ({
    id: e.id,
    event: e.event_type,
    actor_label: e.owner_name ?? e.previous_owner_name ?? null,
    amount: e.price,
    currency: e.currency,
    occurred_at: e.created_at,
  }))
}

/**
 * Escrituras del dueño sobre work_commerce/works — todas pasan por RLS
 * own-row (creator o current_owner, según la columna). saveRoyalty se niega
 * en el cliente cuando la regalía ya está bloqueada; el servidor (RLS más
 * el flujo de aceptar transferencia / completar compra) es la autoridad
 * real — ver TBT_DataModel_Companion_02, "ROYALTY LOCK IS ENFORCED HERE".
 */

async function updateCommerce(workId: string, patch: Partial<WorkCommerce>): Promise<{ error?: string }> {
  const { error } = await supabase.from('work_commerce').update(patch).eq('work_id', workId)
  return error ? { error: error.message } : {}
}

export const saveAvailability = (workId: string, availability: Availability) =>
  updateCommerce(workId, { availability })

export const saveTakingOffers = (workId: string, takingOffers: boolean) =>
  updateCommerce(workId, { taking_offers: takingOffers })

export const savePrice = (workId: string, price: number | null) =>
  updateCommerce(workId, { initial_price: price })

/**
 * Guarda la regalía en los términos canónicos — `royalty_type` + `royalty_value`.
 *
 * Antes escribía la columna porcentual de la migración 008, que ninguna ruta de
 * dinero lee: `royaltyTermsOf` resuelve por los canónicos y de ahí salen
 * `fees.ts` y el libro de ganancias. Editar la regalía aquí no cambiaba nada de
 * lo que se cobra ni de lo que se abona.
 *
 * El editor es porcentual. Una regalía fija no se toca desde aquí —se fija al
 * crear la obra, y `ActionTab` deshabilita el control— porque un monto escrito
 * en una caja rotulada `%` se guardaría como porcentaje.
 */
export async function saveRoyalty(
  workId: string,
  royaltyPct: number,
  currentlyLocked: boolean
): Promise<{ error?: string }> {
  if (currentlyLocked) return { error: 'royaltyLocked' }
  return updateCommerce(workId, { royalty_type: 'percentage', royalty_value: royaltyPct })
}

export async function saveFeatured(workId: string, featured: boolean): Promise<{ error?: string }> {
  const { error } = await supabase.from('works').update({ is_featured: featured }).eq('id', workId)
  return error ? { error: error.message } : {}
}

/**
 * Campos descriptivos editables en el Profile tab (ÍTEM 1: "about (owner-
 * editable in place)", "editable details: category, material"). Los campos
 * SELLADOS — TBT ID, creador, contexto, registro, cadena — no tienen
 * contraparte de escritura aquí a propósito.
 */
async function updateWork(workId: string, patch: { description?: string; category?: string; technique?: string }): Promise<{ error?: string }> {
  const { error } = await supabase.from('works').update(patch).eq('id', workId)
  return error ? { error: error.message } : {}
}

export const saveDescription = (workId: string, description: string) => updateWork(workId, { description })
export const saveCategory = (workId: string, category: string) => updateWork(workId, { category })
export const saveTechnique = (workId: string, technique: string) => updateWork(workId, { technique })
