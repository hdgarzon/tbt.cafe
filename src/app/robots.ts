import type { MetadataRoute } from 'next'

/**
 * Fuera de los buscadores mientras dure el modo sigiloso — Update Package 01, N1.
 *
 * Va junto al `robots: { index: false, follow: false }` del layout raíz: este
 * archivo detiene al rastreador que empieza por `/robots.txt`, y aquel a quien
 * llega a una página por un enlace. Quitar los dos es un punto de la lista de
 * lanzamiento. `npm run check:stealth` falla si falta uno.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  }
}
