import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

/**
 * La sesión de quien llama, en una ruta de este proyecto.
 *
 * Sustituye a `authenticateFlexible` del backend (cross-origin-auth.ts), que
 * aceptaba la sesión por cookie O por cabecera `Bearer` porque servía a dos
 * orígenes a la vez. Aquí solo hay uno y el front manda Bearer —igual que
 * `two-factor.ts`, que resuelve el usuario exactamente así—, de modo que la
 * rama de cookies y toda la maquinaria de CORS que la acompañaba desaparecen.
 *
 * Devuelve también el token. El backend lo devolvía por un motivo aprendido a
 * base de daño: una ruta que llamaba a otra ruta nuestra no puede sacarlo de
 * `getSession()` cuando llegó por cabecera —ese cliente no tiene sesión
 * persistida, solo un header inyectado— y mandaba `Bearer undefined`. Aquí esa
 * clase de llamada debería volverse una llamada de función directa, pero
 * mientras existan, el token está.
 */

export type RouteAuthFailure = { ok: false; status: number; body: { error: string } }
export type RouteAuthSuccess = { ok: true; user: User; token: string; supabase: SupabaseClient }

export async function authenticate(
  request: NextRequest
): Promise<RouteAuthSuccess | RouteAuthFailure> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, status: 401, body: { error: 'not_authenticated' } }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, body: { error: 'not_authenticated' } }

  return { ok: true, user, token, supabase }
}
