import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase con service-role — SOLO SERVIDOR.
 *
 * Nació para el sign-in biométrico (auth/begin, auth/finish), que necesita
 * leer credenciales WebAuthn de alguien que TODAVÍA no tiene sesión y, tras
 * verificar la aserción, acuñar una de verdad — algo que solo el service-role
 * puede hacer. Hoy lo usan también el step-up y la telemetría de proveedores,
 * que escribe una tabla que el usuario no debe poder tocar.
 *
 * Sigue siendo la excepción, no el atajo: perfiles, notificaciones, código
 * privado y enrolamiento operan con la sesión propia y RLS de fila propia. Si
 * una ruta nueva llega aquí, es porque cruza fuera del alcance de su usuario.
 *
 * `two-factor.ts` expone un `serviceClient()` equivalente, con aserciones `!`
 * en vez de comprobar. Sobra uno de los dos.
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
