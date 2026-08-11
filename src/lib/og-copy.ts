/**
 * Copia de las previsualizaciones al compartir — Backend Spec 05 §1 y §9.
 *
 * Vive aparte del diccionario de la app porque la generan el servidor y los
 * rastreadores, que nunca ven el localStorage donde la app guarda el idioma.
 *
 * Lo que la previsualización NO dice está decidido y no debe volver:
 *
 *  - Ni precio ni disponibilidad. Las plataformas cachean las previsualizaciones
 *    de forma agresiva y a menudo indefinida: una obra compartida a 12.000 y
 *    revendida seguiría mostrando 12.000 durante meses. En una plataforma cuyo
 *    producto es la procedencia certificada, equivocarse en una cifra es peor
 *    que callarla. El precio vive en la página, donde está vivo y correcto.
 *  - Ni el dueño actual. Se nombra al CREADOR: la autoría es el hecho
 *    permanente, la propiedad cambia y puede ser anónima. Así la privacidad del
 *    coleccionista queda protegida por construcción, no por una regla aparte.
 *
 * Efecto lateral bueno: como nada volátil entra, la imagen es prácticamente
 * inmutable y que las plataformas la cacheen deja de importar.
 */
import { locales, fallbackLocale, type Locale } from '@/i18n/config'

/** og:locale por idioma (Spec 05 §2.1). */
export const OG_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  es: 'es_ES',
  pt: 'pt_BR',
  fr: 'fr_FR',
}

const CERTIFIED: Record<Locale, string> = {
  en: 'Certificate of authorship, registered on tbt.cafe.',
  es: 'Certificado de autoría, registrado en tbt.cafe.',
  pt: 'Certificado de autoria, registrado no tbt.cafe.',
  fr: "Certificat d'authenticité, enregistré sur tbt.cafe.",
}

const SERIES: Record<Locale, string> = {
  en: 'Series',
  es: 'Serie',
  pt: 'Série',
  fr: 'Série',
}

const BY: Record<Locale, string> = { en: 'by', es: 'de', pt: 'de', fr: 'par' }

/** `{título} · {creador}` — Spec 05 §1. */
export function ogTitle(title: string, creator: string): string {
  return creator ? `${title} · ${creator}` : title
}

/** Línea de certificación, con la serie si la obra pertenece a una. */
export function ogDescription(locale: Locale, series?: string | null): string {
  const base = CERTIFIED[locale]
  return series ? `${base} ${SERIES[locale]}: ${series}.` : base
}

export function ogImageAlt(locale: Locale, title: string, creator: string): string {
  return creator ? `${title} ${BY[locale]} ${creator}` : title
}

/**
 * Idioma para una petición del servidor. La app resuelve el suyo desde
 * localStorage, que aquí no existe: solo queda `Accept-Language`, con inglés de
 * respaldo igual que el resto de la app.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return fallbackLocale
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase()
    const base = tag.split('-')[0]
    const hit = locales.find((l) => l === base)
    if (hit) return hit
  }
  return fallbackLocale
}
