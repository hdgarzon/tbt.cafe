/**
 * i18n de tbt.cafe — Build Spec 01, ÍTEM 3.
 *
 * Diferencia clave con la app actual (que usa ['es','en'] con default 'es'):
 * aquí son CUATRO idiomas y el fallback es **inglés**, no español.
 *
 * Cadena de resolución:
 *   1. override manual del usuario (Settings › Language, persistido en el perfil)
 *   2. navigator.language del navegador
 *   3. fallbackLocale ('en')
 */

export const locales = ['en', 'es', 'pt', 'fr'] as const
export type Locale = (typeof locales)[number]

/** Inglés, NO español. */
export const fallbackLocale: Locale = 'en'

/** Selector inline de Settings: bandera + código de 2 letras. */
export const localeMeta: Record<Locale, { flag: string; code: string; name: string }> = {
  en: { flag: '🇺🇸', code: 'EN', name: 'English' },
  es: { flag: '🇪🇸', code: 'ES', name: 'Español' },
  pt: { flag: '🇧🇷', code: 'PT', name: 'Português' },  // bandera de Brasil, por spec
  fr: { flag: '🇫🇷', code: 'FR', name: 'Français' },
}

export const isLocale = (value: string): value is Locale =>
  (locales as readonly string[]).includes(value)

/**
 * Resuelve un locale soportado a partir de navigator.language (p.ej. "pt-BR").
 * Si no hay match, devuelve el fallback (inglés).
 */
export function resolveLocale(input?: string | null): Locale {
  if (!input) return fallbackLocale
  const base = input.toLowerCase().split('-')[0]
  return isLocale(base) ? base : fallbackLocale
}
