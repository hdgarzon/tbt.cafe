import { supabase } from '@/lib/supabase'
import { holderDisplay } from '@/lib/holder'
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
  /**
   * Step 20: quién la registró. En una obra registrada por un coleccionista,
   * `creator` es quien la registró, no quien la hizo; el creador es el
   * declarado en `bonded` (su nombre, o sin atribuir).
   */
  registered_as: 'creator' | 'collector'
  bonded: { name: string | null; unattributed: boolean; alias: string | null; city: string | null; status: string } | null
  commerce: WorkCommerce | null
  /** Pasaje de contexto generado al certificar (Spec 01) — user_edited_summary si existe, si no ai_summary. */
  context: string | null
  /** Chains 01, 8.2: la lista viva, y la que se registró al certificar. */
  asset_links: string[] | null
  registered_asset_links: string[] | null
  /** Chains 01, 8.1: la grabación del creador. */
  audio_video_url: string | null
  audio_video_type: string | null
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
       certified_at, mint_address, is_featured, current_owner_id, creator_id, registered_as,
       asset_links, registered_asset_links, audio_video_url, audio_video_type,
       series:work_series(id, name, slug),
       bonded:bonded_creators(name, unattributed, alias, city, status),
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
    bonded: data.registered_as === 'collector' ? one(data.bonded) : null,
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
  /** La prueba publicada en Arweave, cuando confirmo (Chains 01 6.3). */
  proofRecordId?: string | null
}

export type LedgerEntry = {
  id?: string
  sequence: number
  event?: string
  transferType?: string | null
  occurredAt: string | null
  recordUri: string | null
  recordHash: string | null
  anchor: LedgerAnchor | null
  /** La transaccion que movio el token en este cambio de dueño (Chains 01, 4.5 y 8.3). */
  solanaSignature?: string | null
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

/**
 * Historial de propiedad, más reciente primero — alimenta la pestaña History.
 *
 * Quien sale en cada fila sigue su interruptor de coleccionista anonimo, en
 * vivo (Chains 01 3.4): anonimo, «Private collector · <codigo de esa tenencia>»;
 * si no, su perfil. El creador sale siempre nombrado. Lo publicado no cambia.
 */
export async function fetchOwnershipHistory(workId: string, privateLabel: string): Promise<OwnershipEvent[]> {
  const { data } = await supabase
    .from('ownership_history')
    .select('id, event_type, owner_name, previous_owner_name, owner_user_id, holder_code, price, currency, created_at')
    .eq('work_id', workId)
    .order('sequence_number', { ascending: false })

  const rows = data ?? []
  const ids = Array.from(new Set(rows.map((e) => e.owner_user_id).filter(Boolean))) as string[]
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, public_alias, display_name, collector_anonymous').in('id', ids)
    : { data: [] as { id: string; public_alias: string | null; display_name: string | null; collector_anonymous: boolean | null }[] }
  const profileOf = new Map((profiles ?? []).map((p) => [p.id, p]))

  return rows.map((e) => ({
    id: e.id,
    event: e.event_type,
    actor_label:
      (e.owner_user_id
        ? holderDisplay(e, profileOf.get(e.owner_user_id) ?? null, privateLabel, e.event_type === 'creation')
        : null) ?? e.previous_owner_name ?? null,
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

/**
 * Toda escritura de work_commerce pasa por /api/work/commerce (Work Order 02,
 * 3.1): el navegador ya no puede escribir la fila (060). La ruta comprueba que
 * quien llama tenga la obra, el estado de vendedor, la pausa, la congelacion,
 * el bloqueo, el techo y el piso. Devuelve el precio si tuvo que subirlo.
 */
async function updateCommerce(
  workId: string,
  patch: { availability?: Availability; price?: number; takingOffers?: boolean; royalty?: { type: 'percentage' | 'fixed'; value: number } }
): Promise<{ error?: string; priceLifted?: number | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { error: 'needSignIn' }
  const res = await fetch('/api/work/commerce', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workId, ...patch }),
  })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { priceLifted: json.priceLifted ?? null } : { error: json.error ?? 'commerce_failed' }
}

export const saveAvailability = (workId: string, availability: Availability) =>
  updateCommerce(workId, { availability })

export const saveTakingOffers = (workId: string, takingOffers: boolean) =>
  updateCommerce(workId, { takingOffers })

export const savePrice = (workId: string, price: number | null) =>
  updateCommerce(workId, { price: price ?? 0 })

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
): Promise<{ error?: string; priceLifted?: number | null }> {
  if (currentlyLocked) return { error: 'royalty_locked' }
  return updateCommerce(workId, { royalty: { type: 'percentage', value: royaltyPct } })
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
/**
 * Chains 01, 8.2: la lista viva de enlaces. Solo el creador mientras tiene la
 * obra; la base lo hace cumplir (070). Lo que no es http(s) no se guarda.
 */
export async function saveAssetLinks(workId: string, links: string[]): Promise<{ error?: string }> {
  const clean = links.map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l))
  const { error } = await supabase.from('works').update({ asset_links: clean }).eq('id', workId)
  return error ? { error: error.message } : {}
}

async function updateWork(workId: string, patch: { description?: string; category?: string; technique?: string }): Promise<{ error?: string }> {
  const { error } = await supabase.from('works').update(patch).eq('id', workId)
  return error ? { error: error.message } : {}
}

export const saveDescription = (workId: string, description: string) => updateWork(workId, { description })
export const saveCategory = (workId: string, category: string) => updateWork(workId, { category })
export const saveTechnique = (workId: string, technique: string) => updateWork(workId, { technique })
