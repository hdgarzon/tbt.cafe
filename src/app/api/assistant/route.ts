/**
 * Asistente — Backend Spec 04.
 *
 * La identidad sale SIEMPRE del token verificado. El cuerpo de la petición no
 * lleva ni puede llevar un identificador de usuario: si lo llevara, alguien
 * podría pedir los registros de otra persona y el sistema podría obedecer
 * (§4.2). El acotado es de construcción, no de prompt.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { retrieve, type Locale } from '@/lib/assistant/knowledge'
import { loadPersonContext, renderContext } from '@/lib/assistant/context'
import { geminiProvider, tierFor } from '@/lib/assistant/provider'
import { fileEscalationTicket } from '@/lib/assistant/escalate'
import { trackProvider } from '@/lib/provider-events'


const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']

export async function POST(request: NextRequest) {

  try {
    const body = (await request.json()) as {
      question?: string
      locale?: string
      viaVoice?: boolean
      history?: Array<{ role: 'user' | 'assistant'; text: string }>
    }

    const question = (body.question ?? '').trim()
    if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })

    const locale = (LOCALES.find((l) => l === body.locale) ?? 'en') as Locale
    const history = (body.history ?? []).slice(-8)

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    const person = await loadPersonContext(supabase, user.id)
    const docs = retrieve(question, locale)

    const tier = tierFor(question, person.tickets.length > 0)
    const reply = await trackProvider(
      { provider: 'gemini', operation: `assistant_answer.${tier}` },
      () =>
        geminiProvider.answer({
          question,
          locale,
          knowledge: docs.map((d) => d.body[locale]),
          personContext: renderContext(person),
          history,
          viaVoice: body.viaVoice === true,
          tier,
        })
    )

    // No saber es un desenlace legítimo y termina en una persona, no en una
    // respuesta inventada. La transcripción viaja con el ticket para que nadie
    // explique su problema dos veces (§5.4).
    let escalatedTo: string | null = null
    if (reply.escalate) {
      escalatedTo = await fileEscalationTicket(supabase, user.id, locale, [
        ...history,
        { role: 'user', text: question },
        { role: 'assistant', text: reply.text },
      ])
    }

    return NextResponse.json({
      text: reply.text,
      cta: reply.cta ?? null,
      escalatedTo,
      /** Tickets abiertos, para que el cliente pueda abrir con el más grave. */
      openTickets: person.tickets,
      grounded: docs.length > 0,
    })
  } catch (error) {
    console.error('[assistant] failed:', error)
    return NextResponse.json({ error: 'assistant_failed' }, { status: 500 })
  }
}
