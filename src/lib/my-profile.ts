import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as browserClient } from '@/lib/supabase'

/**
 * Los datos privados del perfil propio (053).
 *
 * `profiles` ya no concede al cliente sus columnas privadas: la política de
 * lectura es pública y la RLS filtra filas, no columnas, así que cualquiera
 * podía leerlas de todos. Se piden por `my_profile_private()`, que responde
 * solo por quien llama y no devuelve el hash del código privado, sino si existe.
 */
export type MyPrivateProfile = {
  email: string | null
  phone: string | null
  physical_address: string | null
  tax_id: string | null
  legal_name: string | null
  recovery_email: string | null
  recovery_email_verified: boolean
  has_private_code: boolean
  private_code_freq: string | null
  /** La firma actual: trazos normalizados a 330 × 80 (Title Spec 02 §5). */
  signature_strokes: number[][][] | null
}

export async function fetchMyPrivateProfile(client: SupabaseClient = browserClient): Promise<MyPrivateProfile | null> {
  const { data, error } = await client.rpc('my_profile_private')
  if (error || !data) return null
  return data as MyPrivateProfile
}
