import { supabase } from '@/lib/supabase'
import { TBT_BACKEND_URL } from '@/lib/backend'
import type { SeriesWithCount } from '@/lib/series-data'

/**
 * Capa de datos de Cold Brew — el flujo de certificación de una obra
 * (tbt-espresso.html, chooser → p3..p7). Reescribe /brew, que hasta ahora
 * era un stub (Build Spec 01).
 *
 * A diferencia de CreateTBTModal.tsx (Forms), Cold Brew NO vuelve a pedir la
 * identidad del creador — eso ya lo cubre /profile/creator (el "gate" antes
 * del chooser exige que exista). Pero /api/complete-tbt SÍ lee
 * `works.context_data.creatorData` y con eso SOBREESCRIBE el perfil — si se
 * le manda un blob vacío, borra lo que el creador ya configuró. Por eso
 * `buildCreatorDataBlob` relee el perfil real y lo reenvía tal cual, en vez
 * de omitirlo.
 *
 * Todo lo que toca Stripe/IA/minteo pasa por las rutas de Forms (retrofit
 * cross-origin — Build Spec "Cold Brew backend"). Lo que es puro dato propio
 * de este proyecto (subir el archivo, crear la fila `works`, crear/usar una
 * `work_series`) se escribe directo a Supabase, igual que el resto de la app.
 */

async function authHeader(): Promise<{ Authorization: string } | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : null
}

export type CreatorProfileRow = {
  creator_type: 'individual' | 'group' | 'corporation'
  legal_name: string | null
  public_alias: string | null
  collective_name: string | null
  lead_representative: string | null
  entity_name: string | null
  tax_id: string | null
  credentials: string | null
  social_linkedin: string | null
  social_website: string | null
  social_instagram: string | null
  bio: string | null
  email: string | null
  phone: string | null
}

/** ¿El usuario ya tiene un perfil de creador configurado? (el "gate" del chooser). */
export async function fetchCreatorProfile(userId: string): Promise<CreatorProfileRow | null> {
  const { data } = await supabase
    .from('profiles')
    .select(
      'creator_type, legal_name, public_alias, collective_name, lead_representative, entity_name, tax_id, credentials, social_linkedin, social_website, social_instagram, bio, email, phone'
    )
    .eq('id', userId)
    .maybeSingle()
  return data
}

export function isCreatorProfileComplete(p: CreatorProfileRow | null): boolean {
  if (!p) return false
  if (!p.public_alias?.trim()) return false
  if (p.creator_type === 'individual') return !!p.legal_name?.trim()
  if (p.creator_type === 'group') return !!p.collective_name?.trim()
  if (p.creator_type === 'corporation') return !!p.entity_name?.trim()
  return false
}

/** El bloque `creatorData` que complete-tbt reescribe sobre el perfil — reenvía lo que YA existe. */
function buildCreatorDataBlob(p: CreatorProfileRow) {
  return {
    creatorType: p.creator_type,
    legalName: p.legal_name,
    publicAlias: p.public_alias,
    collectiveName: p.collective_name,
    leadRepresentative: p.lead_representative,
    entityName: p.entity_name,
    taxId: p.tax_id,
    credentials: p.credentials,
    socialLinkedin: p.social_linkedin,
    socialWebsite: p.social_website,
    socialInstagram: p.social_instagram,
    aboutCreator: null,
    email: p.email,
  }
}

export async function fetchSeriesOptions(creatorId: string): Promise<SeriesWithCount[]> {
  const { fetchCreatorSeries } = await import('@/lib/series-data')
  return fetchCreatorSeries(creatorId)
}

/** Sube un archivo a works-media (mismo bucket y convención de ruta que Forms) y devuelve su URL pública. */
async function uploadWorksMedia(userId: string, file: File, prefix = ''): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'bin'
  const fileName = `${userId}/${prefix}${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('works-media').upload(fileName, file)
  if (error) return null
  const {
    data: { publicUrl },
  } = supabase.storage.from('works-media').getPublicUrl(fileName)
  return publicUrl
}

export type SimilarityResult =
  | { status: 'skipped' | 'clear'; score?: number }
  | { status: 'warning' | 'blocked'; score: number; matches: unknown[] }

/** Escaneo de originalidad (fase Protección) — real, contra el processor de Forms. */
export async function runSimilarityScan(file: File): Promise<SimilarityResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${TBT_BACKEND_URL}/api/tbt-image/similarity`, { method: 'POST', body: form })
  if (!res.ok) return { status: 'skipped' }
  return res.json()
}

export type ContextResult = { location: string; weather: string; summary: string; generatedAt: string }

/** Contexto generado por IA (fase Context, sub 1+2) — real, vía Gemini en el backend de Forms. */
export async function generateContext(input: {
  creatorAlias: string
  creatorBio?: string
  creatorType: 'individual' | 'group' | 'corporation'
  workTitle: string
  workCategory: string
  workMaterial?: string
  lat?: number
  lng?: number
}): Promise<ContextResult | { error: string }> {
  const auth = await authHeader()
  if (!auth) return { error: 'needSignIn' }
  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/generate-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        creator: { alias: input.creatorAlias, bio: input.creatorBio, creatorType: input.creatorType },
        work: { title: input.workTitle, category: input.workCategory, material: input.workMaterial },
        location: input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : undefined,
      }),
    })
    const body = await res.json()
    if (!res.ok) return { error: body.error ?? 'contextFailed' }
    return body
  } catch {
    return { error: 'contextFailed' }
  }
}

export type CouponResult = { valid: boolean; type?: 'percentage' | 'fixed'; value?: number; error?: string }

export async function validateCoupon(code: string): Promise<CouponResult> {
  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/validate-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const body = await res.json()
    if (!res.ok || !body.valid) return { valid: false, error: body.error }
    return { valid: true, type: body.type, value: body.value }
  } catch {
    return { valid: false, error: 'couponFailed' }
  }
}

export type RoyaltyChoice = 'none' | 'percentage' | 'fixed'

export type DraftInput = {
  // The Work
  title: string
  category: string
  material: string
  dimensions: string
  createdDate: string
  isPublished: boolean
  seriesId: string | null
  newSeriesName: string | null
  // The Image
  imageFile: File
  aboutWork: string
  assetLinks: string[]
  audioVideoFile: File | null
  audioVideoType: 'audio' | 'video' | null
  // Value
  marketPrice: number
  currency: string
  royaltyType: RoyaltyChoice
  royaltyValue: number
  // Protection
  originalityDeclaration: 'original' | 'derivative' | 'authorized_edition'
  derivativeReference: string | null
  // Context
  location: string | null
  coordinates: { lat: number; lng: number } | null
  weather: string | null
  headlines: string | null
  markets: string | null
  aiSummary: string | null
  userEditedSummary: string | null
}

/**
 * Crea la fila `works` en borrador — sube la imagen (y el audio/video si
 * hay), resuelve/crea la serie, y arma `context_data` con el mismo shape
 * anidado que /api/complete-tbt espera leer de vuelta.
 */
export async function createDraftWork(
  userId: string,
  profile: CreatorProfileRow,
  input: DraftInput
): Promise<{ workId?: string; error?: string }> {
  const mediaUrl = await uploadWorksMedia(userId, input.imageFile)
  if (!mediaUrl) return { error: 'uploadFailed' }

  let audioVideoUrl: string | null = null
  if (input.audioVideoFile) {
    audioVideoUrl = await uploadWorksMedia(userId, input.audioVideoFile, 'av_')
  }

  let seriesId = input.seriesId
  if (!seriesId && input.newSeriesName?.trim()) {
    const { data, error } = await supabase
      .from('work_series')
      .insert({
        creator_id: userId,
        name: input.newSeriesName.trim(),
        slug: input.newSeriesName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      })
      .select('id')
      .single()
    if (!error) seriesId = data.id
  }
  if (!seriesId) {
    const { ensureFirstSeries } = await import('@/lib/series-data')
    seriesId = await ensureFirstSeries(userId)
  }

  const contextData = {
    creatorData: buildCreatorDataBlob(profile),
    commProData: {
      marketPrice: String(input.marketPrice),
      currency: input.currency,
      royaltyType: input.royaltyType,
      royaltyValue: String(input.royaltyValue),
      originalityDeclaration: input.originalityDeclaration,
      derivativeReference: input.derivativeReference,
    },
    contextData: {
      location: input.location,
      coordinates: input.coordinates,
      weather: input.weather,
      headlines: input.headlines,
      markets: input.markets,
      aiSummary: input.aiSummary,
      userEditedSummary: input.userEditedSummary,
      signaturePhone: profile.phone,
      isSigned: true,
    },
  }

  const { data: work, error } = await supabase
    .from('works')
    .insert({
      creator_id: userId,
      current_owner_id: userId,
      title: input.title,
      description: input.aboutWork,
      category: input.category,
      technique: input.material,
      media_url: mediaUrl,
      media_type: 'image',
      status: 'draft',
      primary_material: input.material,
      creation_date: input.createdDate || null,
      is_published: input.isPublished,
      work_visibility: input.isPublished ? 'published' : 'private',
      asset_links: input.assetLinks.filter((l) => l.trim()),
      about_work: input.aboutWork,
      audio_video_url: audioVideoUrl,
      audio_video_type: input.audioVideoFile ? input.audioVideoType : null,
      payment_status: 'pending',
      market_price: input.marketPrice || null,
      currency: input.currency,
      royalty_type: input.royaltyType === 'none' ? 'none' : input.royaltyType,
      royalty_value: input.royaltyType !== 'none' ? input.royaltyValue : null,
      series_id: seriesId,
      context_data: contextData,
    })
    .select('id')
    .single()

  if (error || !work) return { error: error?.message ?? 'draftFailed' }
  return { workId: work.id }
}

/** Fase Registro — free/coupon: certifica directo. Pagado: crea el checkout de Stripe. */
export async function startRegistration(
  workId: string,
  couponCode: string | undefined,
  successUrl: string,
  cancelUrl: string
): Promise<{ free?: true; checkoutUrl?: string; error?: string }> {
  const auth = await authHeader()
  if (!auth) return { error: 'needSignIn' }

  if (couponCode) {
    const coupon = await validateCoupon(couponCode)
    if (coupon.valid && coupon.type === 'percentage' && (coupon.value ?? 0) >= 100) {
      const result = await completeTbt(workId, couponCode)
      return 'error' in result ? { error: result.error } : { free: true }
    }
  }

  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/stripe/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ type: 'tbt_creation', workId, successUrl, cancelUrl }),
    })
    const body = await res.json()
    if (!res.ok) return { error: body.error ?? 'checkoutFailed' }
    return { checkoutUrl: body.checkoutUrl }
  } catch {
    return { error: 'checkoutFailed' }
  }
}

export type CompleteTbtResult = {
  success: true
  tbtId: string
  workTitle: string
  solscanUrl: string
  mintAddress: string
  alreadyCompleted?: boolean
}

export async function completeTbt(
  workId: string,
  couponCode?: string,
  sessionId?: string
): Promise<CompleteTbtResult | { error: string }> {
  const auth = await authHeader()
  if (!auth) return { error: 'needSignIn' }
  try {
    const res = await fetch(`${TBT_BACKEND_URL}/api/complete-tbt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ workId, couponCode, sessionId }),
    })
    const body = await res.json()
    if (!res.ok) return { error: body.error ?? 'completeFailed' }
    return body
  } catch {
    return { error: 'completeFailed' }
  }
}
