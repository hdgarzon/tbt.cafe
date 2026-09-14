/**
 * Aviso de cambio de destino de cobro — Backend Spec 06 §4.2 y §5.3; Work Order
 * 01, Step 21.
 *
 * Es la primera de las protectoras: está en ALWAYS_ON porque quien pudiera
 * silenciarla podría redirigir dinero sin que nadie lo note, y hasta ahora no se
 * enviaba desde ningún sitio.
 *
 * Tres decisiones, cada una por un motivo concreto:
 *
 *  - La clave es la fila nueva de `payout_destinations`. Un reintento de la
 *    misma petición choca con el índice de la 047 y no avisa dos veces.
 *
 *  - El enmascarado lo calcula el servidor a partir del destino completo. El que
 *    manda el navegador es texto del cliente, y la plantilla de correo lo
 *    insertaría en el HTML tal cual: quien tenga la sesión podría meter su
 *    propio enlace en el correo de seguridad que recibe el dueño.
 *
 *  - Lleva a /help. Si la persona no hizo el cambio, lo único útil es pedir
 *    ayuda cuanto antes; el artículo de seguridad de Roast lo dice así.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/notify'

/**
 * Lo justo para reconocer la propia sin exponerla, y sin un solo carácter que no
 * sea letra, número, espacio o los separadores de la máscara.
 */
export function maskForNotice(destination: string): string {
  const clean = destination.trim()
  if (/^[\d\s-]+$/.test(clean)) {
    const digits = clean.replace(/\D/g, '')
    return digits.length <= 4 ? '••••' : `•••• ${digits.slice(-4)}`
  }
  const safe = clean.replace(/[^A-Za-z0-9]/g, '')
  if (safe.length <= 8) return '••••'
  return `${safe.slice(0, 4)}…${safe.slice(-4)}`
}

export async function notifyPayoutDestinationChanged(
  client: SupabaseClient,
  params: {
    userId: string
    /** La fila nueva de payout_destinations: es el hecho que se avisa. */
    destinationId: string
    /** Completos. Solo salen de aquí enmascarados. */
    destination: string
    previousDestination: string | null
  }
): Promise<void> {
  await notify(client, {
    userId: params.userId,
    eventKey: 'payout_destination',
    dedupeKey: params.destinationId,
    data: {
      to: maskForNotice(params.destination),
      from: params.previousDestination ? maskForNotice(params.previousDestination) : '',
    },
    href: '/help',
  })
}
