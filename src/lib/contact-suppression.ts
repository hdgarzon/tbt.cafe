import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * La lista de supresión — 11+ Addendum, con el registro por coleccionista.
 *
 * El bloque de la sucesión y el campo "cómo contactarle" capturan el contacto
 * de un tercero que nunca consintió y todavía no puede negarse. Quien pidió no
 * ser contactado está en `contact_suppressions`, guardado solo como hash del
 * contacto normalizado; un contacto de tercero que coincide no se guarda.
 */

export type ContactKind = 'email' | 'phone'

export function normalizeContact(raw: string): { kind: ContactKind; value: string } | null {
  const s = raw.trim()
  if (!s) return null
  if (s.includes('@')) return { kind: 'email', value: s.toLowerCase() }
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7) return null
  return { kind: 'phone', value: `+${digits}` }
}

export function contactHash(value: string): string {
  return createHash('sha256').update(`tbt-contact:${value}`).digest('hex')
}

/** El contacto tal como se guarda, o null si falta o pidió no ser contactado. */
export async function keepContact(admin: SupabaseClient, raw: string | null | undefined): Promise<{ value: string | null; suppressed: boolean }> {
  const n = raw ? normalizeContact(raw) : null
  if (!n) return { value: null, suppressed: false }
  const { data } = await admin.from('contact_suppressions').select('contact_hash').eq('contact_hash', contactHash(n.value)).maybeSingle()
  return data ? { value: null, suppressed: true } : { value: n.value, suppressed: false }
}
