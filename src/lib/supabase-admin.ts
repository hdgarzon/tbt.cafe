import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase con service-role — SOLO SERVIDOR.
 *
 * Usado exclusivamente por el sign-in biométrico (auth/begin, auth/finish):
 * necesita leer credenciales WebAuthn de un usuario que TODAVÍA no tiene
 * sesión (está intentando entrar) y, tras verificar la aserción, acuñar una
 * sesión real de Supabase — algo que solo el service-role puede hacer.
 *
 * Todo lo demás en tbt.cafe (perfiles, notificaciones, código privado,
 * enrolamiento biométrico) opera con la sesión del propio usuario y RLS de
 * fila propia. Este es el único punto del front nuevo que usa service-role.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridas para el cliente admin'
    )
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
