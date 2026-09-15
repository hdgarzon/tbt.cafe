import type { NextRequest } from 'next/server'

/**
 * Solo Vercel dispara un barrido.
 *
 * Vercel manda `Authorization: Bearer ${CRON_SECRET}` cuando la variable existe.
 * Aquí, sin variable no pasa nadie: estos barridos sueltan retenciones en Stripe
 * y cambian el estado del dinero, y una ruta que queda abierta porque faltó una
 * variable es peor que un barrido que no corre y lo dice en el log.
 */
export function cronAuthorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}
