import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CREATOR_CODE_RE } from './records'

/**
 * El codigo del creador — Chains 01, 2.2.
 *
 * Aleatorio, emitido una vez por creador y guardado en el registro
 * (`profiles.creator_code`). Estable: la autoria es publica y todas las obras
 * de una persona llevan el mismo. Nunca derivado de nada, a diferencia del
 * seudonimo del UUID, que cualquiera podia calcular.
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

function freshCode(): string {
  const bytes = randomBytes(10)
  let out = 'cr_'
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % 32]
  return out
}

/** Devuelve el codigo del creador, emitiendolo si aun no tiene. Solo con el service role. */
export async function creatorCodeFor(admin: SupabaseClient, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await admin.from('profiles').select('creator_code').eq('id', userId).single()
    if (data?.creator_code && CREATOR_CODE_RE.test(data.creator_code)) return data.creator_code

    // `is null`: dos certificaciones a la vez no emiten dos codigos; la que
    // pierde vuelve a leer el que gano. Un choque de unicidad, igual.
    await admin.from('profiles').update({ creator_code: freshCode() }).eq('id', userId).is('creator_code', null)
  }
  throw new Error('creator-code: no se pudo emitir el codigo del creador.')
}
