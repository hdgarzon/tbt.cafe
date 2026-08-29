import { supabase } from '@/lib/supabase'
import { methodFeeOf, payoutQuote, type PayoutQuote } from '@/lib/fees'

/**
 * Capa de datos de Payouts — Backend Spec 02, y Spec 01 §4 para la ventana
 * de liquidación.
 *
 * Dos reglas que gobiernan casi todo lo de este archivo:
 *
 *  - Los métodos son DATOS (§3). Nada aquí conoce 'usdc' ni 'bank' por su
 *    nombre; se lee el registro y se pinta lo que devuelva. Añadir Pix es una
 *    fila, no un cambio en este archivo.
 *  - Un payout NUNCA es cobrable de inmediato (§4). Lo que se puede cobrar es
 *    solo lo que está en `available`; lo pendiente se muestra igual, con por
 *    qué está retenido y cuándo libera, pero no es seleccionable.
 *
 * La escritura vive en el servidor, no aquí: el cliente solo lee. Crear un
 * bloque de cobro o cambiar un destino exige biométrico + código privado
 * (§5.1) y pasa por la ruta del backend, que es la que tiene el service role.
 */

/* ── El registro de métodos ─────────────────────────────────────────────── */

export type PayoutMethod = {
  id: string
  /** Clave i18n, no texto: se pinta en los cuatro idiomas. */
  displayNameKey: string
  provider: 'stripe_connect_stablecoin' | 'stripe_connect_bank' | 'other'
  destination: {
    fieldType: 'wallet_address' | 'bank_account' | 'pix_key' | 'phone' | 'email'
    network: string | null
    validation: string | null
    /** Las direcciones de wallet se re-escriben para confirmar (§3.2). */
    requiresConfirm: boolean
    labelKey: string
  }
  fees: { platformPct: number; methodPct: number; methodFlat: number }
  limits: { min: number | null; max: number | null }
  settlementEstimateKey: string
}

/**
 * Métodos disponibles para un país — §3.3.
 *
 * Devuelve lista vacía cuando no hay ninguno, y eso NO es un caso de borde a
 * ignorar: el spec pide que la UI lo diga con todas las letras y mande a
 * soporte, en vez de pintar un selector vacío o caer a un método por defecto
 * que va a fallar.
 */
export async function fetchPayoutMethods(country: string | null): Promise<PayoutMethod[]> {
  const { data, error } = await supabase
    .from('payout_methods')
    .select('*')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })

  if (error || !data) return []

  return data
    .filter((m) => {
      const countries: string[] = m.countries ?? []
      if (countries.includes('*')) return true
      return country ? countries.includes(country) : false
    })
    .map((m) => ({
      id: m.id,
      displayNameKey: m.display_name_key,
      provider: m.provider,
      destination: {
        fieldType: m.dest_field_type,
        network: m.dest_network,
        validation: m.dest_validation,
        requiresConfirm: m.dest_requires_confirm,
        labelKey: m.dest_label_key,
      },
      fees: {
        platformPct: Number(m.platform_pct),
        methodPct: Number(m.method_pct),
        methodFlat: Number(m.method_flat),
      },
      limits: {
        min: m.min_amount === null ? null : Number(m.min_amount),
        max: m.max_amount === null ? null : Number(m.max_amount),
      },
      settlementEstimateKey: m.settlement_estimate_key,
    }))
}

/** País que resuelve los métodos. Sustituto de connect_account.country (§3.3). */
export async function fetchPayoutCountry(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('payout_country')
    .eq('id', userId)
    .maybeSingle()
  return data?.payout_country ?? null
}

/* ── La cuenta de Connect ────────────────────────────────────────────────── */

export type ConnectStatus = 'onboarding' | 'active' | 'restricted' | 'rejected'

export type ConnectAccount = {
  accountId: string
  status: ConnectStatus
  country: string
  transfersEnabled: boolean
}

/**
 * La cuenta de cobro de esta persona, si ya existe.
 *
 * La RLS de 024 solo deja leer la propia, que es exactamente lo que la
 * pantalla necesita saber: si ya puede cobrar. El estado lo escribe el webhook
 * con el service role; aquí no se deduce de nada.
 */
export async function fetchConnectAccount(userId: string): Promise<ConnectAccount | null> {
  const { data } = await supabase
    .from('payout_connect_accounts')
    .select('account_id, status, country, transfers_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return null

  return {
    accountId: data.account_id,
    status: data.status as ConnectStatus,
    country: data.country,
    transfersEnabled: data.transfers_enabled,
  }
}

/**
 * Pide el enlace de alta y devuelve a dónde hay que ir.
 *
 * Stripe los emite de un solo uso y con caducidad, así que se pide en el
 * momento de usarlo y no se guarda nunca. `country` solo cuenta la primera
 * vez: la ruta lo exige al crear la cuenta y lo ignora después, porque Stripe
 * lo congela al activarla.
 */
export async function startConnectOnboarding(
  country: string | null
): Promise<{ url?: string; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { error: 'needSignIn' }

  const res = await fetch('/api/payouts/connect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(country ? { country: country.toUpperCase() } : {}),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.url) return { error: body.error ?? 'connectFailed' }
  return { url: body.url }
}

/* ── El libro de ganancias ──────────────────────────────────────────────── */

export type EarningState = 'pending' | 'available' | 'collected'

export type Earning = {
  id: string
  source: 'sale' | 'royalty' | 'transfer' | 'offer'
  workId: string | null
  title: string | null
  tbtId: string | null
  amount: number
  state: EarningState
  /** Cuándo libera. Null en transferencias y ofertas: liberan por evento. */
  releasesAt: string | null
  holdReason: 'settlement_window' | 'awaiting_counterparty' | null
  createdAt: string
}

/**
 * Promueve a `available` lo que ya cumplió su ventana, solo del usuario en
 * sesión. Se llama al abrir Payouts: sin esto, un dinero cuyo plazo venció
 * anoche seguiría leyéndose "pendiente" hasta el siguiente barrido del cron.
 *
 * Es idempotente y barata: si no hay nada vencido, no toca ninguna fila.
 */
export async function releaseDueEarnings(): Promise<number> {
  const { data, error } = await supabase.rpc('release_my_due_payout_earnings')
  if (error) {
    // No rompe la pantalla —la lista se lee igual—, pero SÍ se dice. El fallo
    // aquí es invisible por naturaleza: si al rol `authenticated` le faltara el
    // permiso de ejecución, lo vencido nunca pasaría a `available` y nadie se
    // enteraría, porque la lista seguiría pintando bien lo demás.
    console.error('[payouts] no se pudieron liberar las ganancias vencidas:', error.message)
    return 0
  }
  return Number(data ?? 0)
}

export async function fetchEarnings(userId: string): Promise<Earning[]> {
  // Primero liberar lo vencido, después leer: al revés, la pantalla mostraría
  // el estado de hace un momento y la persona vería "pendiente" algo que ya
  // puede cobrar.
  await releaseDueEarnings()

  const { data } = await supabase
    .from('payout_earnings')
    .select('id, source, work_id, amount, state, releases_at, hold_reason, created_at, work:works(tbt_id, title)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return (data ?? []).map((e) => {
    const work = Array.isArray(e.work) ? e.work[0] : e.work
    return {
      id: e.id,
      source: e.source,
      workId: e.work_id,
      title: work?.title ?? null,
      tbtId: work?.tbt_id ?? null,
      amount: Number(e.amount),
      state: e.state,
      releasesAt: e.releases_at,
      holdReason: e.hold_reason,
      createdAt: e.created_at,
    }
  })
}

/** Lo cobrable ahora mismo. Es lo único seleccionable en la pantalla de cobro. */
export function availableOf(earnings: Earning[]): Earning[] {
  return earnings.filter((e) => e.state === 'available')
}

/** Lo que existe pero todavía no se puede cobrar — se muestra, atenuado (§4.4). */
export function pendingOf(earnings: Earning[]): Earning[] {
  return earnings.filter((e) => e.state === 'pending')
}

export function sumOf(earnings: Earning[]): number {
  return Math.round(earnings.reduce((total, e) => total + e.amount, 0) * 100) / 100
}

/* ── Destinos ───────────────────────────────────────────────────────────── */

export type PayoutDestination = {
  id: string
  methodId: string
  /** Nunca la dirección entera: en pantalla siempre va enmascarada. */
  masked: string
  network: string | null
  isDefault: boolean
}

export async function fetchDefaultDestination(userId: string): Promise<PayoutDestination | null> {
  const { data } = await supabase
    .from('payout_destinations')
    .select('id, method_id, destination_masked, network, is_default')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    methodId: data.method_id,
    masked: data.destination_masked,
    network: data.network,
    isDefault: data.is_default,
  }
}

/**
 * Enmascarado de una dirección de wallet: primeros 4 y últimos 4.
 * Suficiente para que la persona reconozca la suya sin exponerla entera en
 * una pantalla que alguien puede estar mirando por encima del hombro.
 */
export function maskWallet(address: string): string {
  const clean = address.trim()
  if (clean.length <= 12) return clean
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`
}

/** Enmascarado de una cuenta bancaria: solo los últimos cuatro. */
export function maskAccount(account: string): string {
  const digits = account.replace(/\D/g, '')
  if (digits.length <= 4) return digits
  return `•••• ${digits.slice(-4)}`
}

/* ── Bloques de liquidación ─────────────────────────────────────────────── */

export type PayoutBlock = {
  id: string
  blockId: string
  methodId: string
  destinationMasked: string
  gross: number
  platformFee: number
  methodFee: number
  net: number
  status: 'processing' | 'paid' | 'failed'
  createdAt: string
  settledAt: string | null
}

export async function fetchPayoutBlocks(userId: string): Promise<PayoutBlock[]> {
  const { data } = await supabase
    .from('payout_blocks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return (data ?? []).map((b) => ({
    id: b.id,
    blockId: b.block_id,
    methodId: b.method_id,
    destinationMasked: b.destination_masked,
    gross: Number(b.gross),
    platformFee: Number(b.platform_fee),
    methodFee: Number(b.method_fee),
    net: Number(b.net),
    status: b.status,
    createdAt: b.created_at,
    settledAt: b.settled_at,
  }))
}

/* ── El desglose del cobro ──────────────────────────────────────────────── */

/**
 * Lo que se le muestra antes de confirmar: bruto → comisión de plataforma →
 * comisión del rail → neto (§4, paso 5).
 *
 * Las tres comisiones salen del método, no de constantes de este archivo, y
 * el cálculo pasa por `fees.ts`: ninguna ruta de dinero hace su propia
 * aritmética.
 */
export function quoteCollection(gross: number, method: PayoutMethod): PayoutQuote {
  return payoutQuote(gross, methodFeeOf(method.fees, gross), method.fees.platformPct)
}

/**
 * Si el monto entra en los límites del método. Devuelve la razón para poder
 * decirla, en vez de deshabilitar un botón sin explicación.
 */
export function checkLimits(
  gross: number,
  method: PayoutMethod
): { ok: true } | { ok: false; reason: 'below_min' | 'above_max'; limit: number } {
  const { min, max } = method.limits
  if (min !== null && gross < min) return { ok: false, reason: 'below_min', limit: min }
  if (max !== null && gross > max) return { ok: false, reason: 'above_max', limit: max }
  return { ok: true }
}
