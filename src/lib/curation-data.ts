import { supabase } from '@/lib/supabase'

/**
 * Capa de datos de Curación (Build Spec 02, Ítem 5, migración 009) — el
 * "critique" renombrado. Tres ejes (Técnica/Color/Significado) de 1 a 5,
 * texto libre obligatorio, pública o privada, sobre cualquier target
 * (creador, serie, featured o una obra) con el mismo esquema de ID estable
 * que favoritos.
 */

export type CurationTargetType = 'creator' | 'series' | 'work' | 'featured'

export type Curation = {
  id: string
  author_id: string
  author_name: string
  technique: number | null
  color: number | null
  meaning: number | null
  body: string
  is_public: boolean
  created_at: string
}

export type SaveCurationInput = {
  targetType: CurationTargetType
  targetId: string
  technique: number
  color: number
  meaning: number
  body: string
  isPublic: boolean
}

/**
 * Curaciones visibles para el usuario actual sobre un target: públicas + las
 * suyas propias.
 *
 * curations.author_id referencia auth.users(id), NO public.profiles(id) — no
 * hay FK formal entre curations y profiles, así que PostgREST no puede
 * resolver un embed. Se resuelven los nombres en un segundo fetch batched
 * por profiles.id (que comparte PK con auth.users.id).
 */
export async function fetchCurations(targetType: CurationTargetType, targetId: string): Promise<Curation[]> {
  const { data } = await supabase
    .from('curations')
    .select('id, author_id, technique, color, meaning, body, is_public, created_at')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('created_at', { ascending: false })

  const rows = data ?? []
  if (!rows.length) return []

  const authorIds = Array.from(new Set(rows.map((c) => c.author_id)))
  const { data: authors } = await supabase
    .from('profiles')
    .select('id, display_name, public_alias')
    .in('id', authorIds)

  const nameOf = new Map(
    (authors ?? []).map((a) => [a.id, a.public_alias || a.display_name || 'Anonymous'])
  )

  return rows.map((c) => ({
    id: c.id,
    author_id: c.author_id,
    author_name: nameOf.get(c.author_id) ?? 'Anonymous',
    technique: c.technique,
    color: c.color,
    meaning: c.meaning,
    body: c.body,
    is_public: c.is_public,
    created_at: c.created_at,
  }))
}

/** Conteo de curaciones públicas sobre un target — para el badge del ícono. */
export async function countCurations(targetType: CurationTargetType, targetId: string): Promise<number> {
  const { count } = await supabase
    .from('curations')
    .select('id', { count: 'exact', head: true })
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('is_public', true)
  return count ?? 0
}

export async function saveCuration(input: SaveCurationInput): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'needSignIn' }

  const { error } = await supabase.from('curations').insert({
    author_id: user.id,
    target_type: input.targetType,
    target_id: input.targetId,
    technique: input.technique,
    color: input.color,
    meaning: input.meaning,
    body: input.body,
    is_public: input.isPublic,
  })
  return error ? { error: error.message } : {}
}
