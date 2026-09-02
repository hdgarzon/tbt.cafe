/**
 * Datos de la persona para el asistente — Backend Spec 04 §4.
 *
 * El asistente puede ver los datos transaccionales de quien está autenticado.
 * Eso lo vuelve mucho más útil: "tu cobro de 2.340 USD está pendiente hasta el
 * 14 de agosto" en vez de una explicación genérica de ventanas de liquidación.
 *
 * RESTRICCIÓN DE CONSTRUCCIÓN, no una instrucción del prompt (§4.2):
 *
 * Los datos se traen en el servidor y ya vienen acotados a la persona
 * autenticada antes de que el modelo vea nada. Ninguna función de este módulo
 * acepta un identificador de usuario elegido por el modelo: el `userId` sale del
 * token verificado y nada más. Si existiera una herramienta que recibe un id,
 * alguien podría pedir los registros de otra persona y el sistema podría
 * obedecer — eso es una filtración de datos, no un error.
 *
 * Las restricciones a nivel de prompt no bastan. "Habla solo de los datos de
 * este usuario" se puede rodear conversando; el acotado en servidor no.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type PersonContext = {
  works: Array<{ tbtId: string; title: string; status: string; createdAt: string }>
  transfers: Array<{ status: string; value: number | null; when: string }>
  offers: Array<{ amount: number; status: string; when: string }>
  tickets: Array<{
    ref: string
    category: string
    severity: string
    status: string
    subject: string
    updatedAt: string
  }>
  /** Solo si están puestos, nunca los valores (§4.1). */
  authStatus: { hasEmail: boolean; hasPrivateCode: boolean }
}

/**
 * Trae el contexto de la persona autenticada.
 *
 * `userId` viene del token ya verificado por quien llama. No es un parámetro
 * que el modelo pueda influir.
 */
export async function loadPersonContext(
  supabase: SupabaseClient,
  userId: string
): Promise<PersonContext> {
  const [works, transfers, offers, tickets, profile] = await Promise.all([
    supabase
      .from('works')
      .select('tbt_id, title, status, created_at')
      .eq('creator_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('transfers')
      .select('outcome, payment_status, sale_price, initiated_at')
      .eq('from_owner_id', userId)
      .order('initiated_at', { ascending: false })
      .limit(10),
    supabase
      .from('offers')
      .select('amount, status, created_at')
      .eq('from_user', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('tickets')
      .select('ref, category, severity, status, subject, updated_at')
      .eq('subject_user', userId)
      .in('status', ['open', 'answered'])
      // Lo financiero primero, y dentro de eso lo más reciente (§5.1).
      .order('severity', { ascending: true })
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('profiles').select('email, private_code_hash').eq('id', userId).single(),
  ])

  return {
    works: (works.data ?? []).map((w) => ({
      tbtId: w.tbt_id ?? '',
      title: w.title ?? '',
      status: w.status ?? '',
      createdAt: w.created_at,
    })),
    transfers: (transfers.data ?? []).map((t) => ({
      status: t.outcome ?? t.payment_status ?? '',
      value: t.sale_price,
      when: t.initiated_at,
    })),
    offers: (offers.data ?? []).map((o) => ({
      amount: Number(o.amount),
      status: o.status,
      when: o.created_at,
    })),
    tickets: (tickets.data ?? []).map((t) => ({
      ref: t.ref,
      category: t.category,
      severity: t.severity,
      status: t.status,
      subject: t.subject,
      updatedAt: t.updated_at,
    })),
    authStatus: {
      hasEmail: !!profile.data?.email,
      // El estado, nunca el código. El propio valor va cifrado y no se recupera.
      hasPrivateCode: !!profile.data?.private_code_hash,
    },
  }
}

/**
 * Serializa el contexto para el modelo.
 *
 * Va marcado explícitamente como DATOS y no como instrucciones: el texto dentro
 * de un ticket lo escribió una persona, y nunca debe ejecutarse como una orden
 * (§4.2).
 */
/**
 * Lo que el modelo puede mirar de esta persona — o el aviso de que no hay nadie.
 *
 * `null` significa VISITA sin sesión, y se dice explícitamente en vez de mandar
 * una cadena vacía. Vacío el modelo lo lee como «esta persona no tiene nada», y
 * de ahí a inventarle una cifra hay un paso; dicho, sabe que no tiene registros
 * que mirar y que la salida es invitar a entrar (Gating Spec 01, ítem 2).
 */
export function renderContext(ctx: PersonContext | null): string {
  if (!ctx) {
    return [
      'You are speaking to a visitor who has not signed in.',
      'There are no records for them: no works, no transfers, no offers, no support requests.',
      'If a question needs their account, say so plainly and invite them to sign in.',
      'Never estimate, guess or invent a figure about them.',
    ].join('\n')
  }

  const lines: string[] = []
  if (ctx.tickets.length) {
    lines.push(
      'Open support requests: ' +
        ctx.tickets
          .map((t) => `${t.ref} (${t.category}, ${t.severity}, ${t.status}): ${t.subject}`)
          .join(' | ')
    )
  }
  if (ctx.works.length) {
    lines.push(
      `Works registered: ${ctx.works.length}. Most recent: ` +
        ctx.works.slice(0, 5).map((w) => `${w.title} [${w.tbtId}] ${w.status}`).join(', ')
    )
  }
  if (ctx.transfers.length) {
    lines.push(`Recent transfers: ${ctx.transfers.map((t) => `${t.status}`).join(', ')}`)
  }
  if (ctx.offers.length) {
    lines.push(`Offers made: ${ctx.offers.map((o) => `${o.amount} (${o.status})`).join(', ')}`)
  }
  lines.push(
    `Email on file: ${ctx.authStatus.hasEmail ? 'yes' : 'no'}. Private code set: ${ctx.authStatus.hasPrivateCode ? 'yes' : 'no'}.`
  )
  return lines.join('\n')
}
