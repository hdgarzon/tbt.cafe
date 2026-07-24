import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Utilidades compartidas del biométrico WebAuthn — companion doc §3-5.
 *
 * Todo opera con el token del propio usuario (no service-role): el enrolamiento
 * exige sesión activa, y la RLS de webauthn_credentials / webauthn_challenges
 * (fila propia) garantiza el aislamiento. Así el front nuevo no necesita la
 * service-role key.
 */

/**
 * Config del Relying Party derivada del Origin que envía el navegador.
 * Funciona igual en localhost (dev) y en tbt.cafe (prod) sin hardcodear
 * dominios: rpID = hostname, expectedOrigin = origin completo.
 */
export function rpFromRequest(request: NextRequest): { rpID: string; origin: string } | null {
  const origin = request.headers.get('origin')
  if (!origin) return null
  try {
    return { rpID: new URL(origin).hostname, origin }
  } catch {
    return null
  }
}

export const RP_NAME = 'tbt.cafe'

/** Cliente Supabase ligado al token del usuario (respeta RLS). */
export function userClient(token: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

/** Extrae el bearer token del header Authorization. */
export const bearer = (request: NextRequest): string | null =>
  request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null

/** Autentica la petición; devuelve { supabase, userId } o una respuesta de error. */
export async function requireUser(request: NextRequest) {
  const token = bearer(request)
  if (!token) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const supabase = userClient(token)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Sesión inválida' }, { status: 401 }) }
  }
  return { supabase, userId: user.id, userName: user.phone ?? user.email ?? user.id }
}

/** Guarda un reto de un solo uso, ligado al usuario, con TTL corto. */
export async function storeChallenge(
  supabase: SupabaseClient,
  userId: string,
  challenge: string,
  kind: 'registration' | 'authentication'
) {
  // Limpia retos previos del mismo tipo para que no se acumulen
  await supabase
    .from('webauthn_challenges')
    .delete()
    .eq('user_id', userId)
    .eq('kind', kind)

  return supabase.from('webauthn_challenges').insert({ user_id: userId, challenge, kind })
}

/** Recupera y CONSUME (borra) el reto vigente — de un solo uso. */
export async function consumeChallenge(
  supabase: SupabaseClient,
  userId: string,
  kind: 'registration' | 'authentication'
): Promise<string | null> {
  const { data } = await supabase
    .from('webauthn_challenges')
    .select('id, challenge, expires_at')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  // Borrarlo siempre (un solo uso), aunque haya expirado
  await supabase.from('webauthn_challenges').delete().eq('id', data.id)

  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return data.challenge
}

/** Etiqueta de dispositivo a partir del User-Agent, para la lista del hub. */
export function deviceLabel(request: NextRequest): string {
  const ua = request.headers.get('user-agent') ?? ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Android/i.test(ua)) return 'Android'
  return 'Dispositivo'
}
