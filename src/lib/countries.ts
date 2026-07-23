/**
 * Países para el selector del flujo de autenticación (Master Handoff §7.1).
 *
 * `groups` define el formateo de dígitos en vivo por país: cada número es el
 * tamaño de un grupo. p.ej. Colombia [3,3,4] → "300 123 4567".
 */

export type Country = {
  iso: string
  name: string
  flag: string
  dial: string
  /** Agrupación de dígitos para el formateo en vivo. */
  groups: number[]
}

export const COUNTRIES: readonly Country[] = [
  { iso: 'CO', name: 'Colombia',       flag: '🇨🇴', dial: '+57',  groups: [3, 3, 4] },
  { iso: 'US', name: 'United States',  flag: '🇺🇸', dial: '+1',   groups: [3, 3, 4] },
  { iso: 'MX', name: 'México',         flag: '🇲🇽', dial: '+52',  groups: [2, 4, 4] },
  { iso: 'BR', name: 'Brasil',         flag: '🇧🇷', dial: '+55',  groups: [2, 5, 4] },
  { iso: 'AR', name: 'Argentina',      flag: '🇦🇷', dial: '+54',  groups: [2, 4, 4] },
  { iso: 'CL', name: 'Chile',          flag: '🇨🇱', dial: '+56',  groups: [1, 4, 4] },
  { iso: 'PE', name: 'Perú',           flag: '🇵🇪', dial: '+51',  groups: [3, 3, 3] },
  { iso: 'EC', name: 'Ecuador',        flag: '🇪🇨', dial: '+593', groups: [2, 3, 4] },
  { iso: 'ES', name: 'España',         flag: '🇪🇸', dial: '+34',  groups: [3, 3, 3] },
  { iso: 'FR', name: 'France',         flag: '🇫🇷', dial: '+33',  groups: [1, 2, 2, 2, 2] },
  { iso: 'PT', name: 'Portugal',       flag: '🇵🇹', dial: '+351', groups: [3, 3, 3] },
  { iso: 'GB', name: 'United Kingdom', flag: '🇬🇧', dial: '+44',  groups: [4, 6] },
  { iso: 'CA', name: 'Canada',         flag: '🇨🇦', dial: '+1',   groups: [3, 3, 4] },
] as const

/** Colombia por defecto; en producción el país inicial vendrá de la IP (seam). */
export const DEFAULT_COUNTRY = COUNTRIES[0]

export const findCountry = (iso: string) =>
  COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY

/** Cantidad de dígitos que espera un país, según su agrupación. */
export const expectedDigits = (c: Country) =>
  c.groups.reduce((sum, g) => sum + g, 0)

/** Aplica el formateo por país a una cadena de dígitos crudos. */
export function formatNational(digits: string, c: Country): string {
  const clean = digits.replace(/\D/g, '').slice(0, expectedDigits(c))
  const out: string[] = []
  let i = 0
  for (const size of c.groups) {
    if (i >= clean.length) break
    out.push(clean.slice(i, i + size))
    i += size
  }
  return out.join(' ')
}

/** Número en E.164 para enviar a Supabase/Twilio. */
export const toE164 = (digits: string, c: Country) =>
  `${c.dial}${digits.replace(/\D/g, '')}`

/** Valida que el número tenga la longitud esperada del país. */
export const isPlausible = (digits: string, c: Country) =>
  digits.replace(/\D/g, '').length === expectedDigits(c)

/** Enmascarado para el hub: código de marcación + últimos 4 (Master Handoff §14). */
export const maskPhone = (digits: string, c: Country) => {
  const clean = digits.replace(/\D/g, '')
  return `${c.dial} ••• ••• ${clean.slice(-4)}`
}
