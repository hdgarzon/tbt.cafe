/**
 * Tickets de soporte — Backend Spec 03.
 *
 * Un ticket no es un mensaje escrito: es un registro CON UN ORIGEN, y el origen
 * determina cuánto sabe ya el sistema. Un humano describe el problema con sus
 * palabras y hay que preguntarle; uno de sistema llega completo.
 */
import { supabase } from '@/lib/supabase'

export const TICKET_CATEGORIES = [
  'payments',
  'payouts',
  'transfers',
  'registration',
  'authentication',
  'other',
] as const

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export type TicketOrigin = 'human' | 'system' | 'ai_escalation'
export type TicketSeverity = 'financial' | 'secondary'
export type TicketStatus = 'open' | 'answered' | 'resolved' | 'closed'

export type TicketReply = {
  id: string
  authorType: 'customer' | 'team' | 'system' | 'ai'
  authorName: string
  body: string
  createdAt: string
}

export type Ticket = {
  id: string
  ref: string
  origin: TicketOrigin
  category: TicketCategory
  severity: TicketSeverity
  status: TicketStatus
  subject: string
  body: string
  createdAt: string
  replies: TicketReply[]
}

/**
 * Severidad derivada de la categoría (§2). Lo que toca dinero se eleva: cobrar,
 * pagar y transferir fallan de formas caras.
 */
export function severityForCategory(category: TicketCategory): TicketSeverity {
  return category === 'payments' || category === 'payouts' || category === 'transfers'
    ? 'financial'
    : 'secondary'
}

/** Los tickets de la persona, incluidos los que abrió el sistema por ella (§7). */
export async function fetchMyTickets(userId: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ref, origin, category, severity, status, subject, body, created_at, replies:ticket_replies(id, author_type, author_name, body, created_at)')
    .eq('subject_user', userId)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data.map((t) => ({
    id: t.id,
    ref: t.ref,
    origin: t.origin as TicketOrigin,
    category: t.category as TicketCategory,
    severity: t.severity as TicketSeverity,
    status: t.status as TicketStatus,
    subject: t.subject,
    body: t.body,
    createdAt: t.created_at,
    replies: ((t.replies ?? []) as Array<Record<string, string>>)
      .map((r) => ({
        id: r.id,
        authorType: r.author_type as TicketReply['authorType'],
        authorName: r.author_name,
        body: r.body,
        createdAt: r.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }))
}

/**
 * Abre un ticket humano.
 *
 * `surface` es dónde estaba la persona al abrirlo. Es información que sale
 * gratis y vale: quien reporta desde la pantalla de payouts ya dijo algo sobre
 * su problema sin escribirlo.
 */
export async function openTicket(
  userId: string,
  category: TicketCategory,
  subject: string,
  body: string,
  surface?: string
): Promise<{ error?: string }> {
  const { error } = await supabase.from('tickets').insert({
    origin: 'human',
    category,
    severity: severityForCategory(category),
    subject,
    body,
    subject_user: userId,
    context: surface ? { surface } : {},
  })
  return error ? { error: error.message } : {}
}

/** Respuesta del cliente. Si el ticket estaba 'answered', vuelve a 'open'. */
export async function replyToTicket(
  ticketId: string,
  authorName: string,
  body: string
): Promise<{ error?: string }> {
  const { error } = await supabase.from('ticket_replies').insert({
    ticket_id: ticketId,
    author_type: 'customer',
    author_name: authorName,
    body,
  })
  return error ? { error: error.message } : {}
}
