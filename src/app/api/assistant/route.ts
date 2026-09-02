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

    /*
     * La sesión es OPCIONAL — Gating Spec 01, ítem 2.
     *
     * La base de conocimiento ya era separable: `retrieve()` es una función pura
     * sobre un arreglo estático de documentos y no toca dato de nadie. La única
     * que sí lo hace es `loadPersonContext`, y esa es la que se salta.
     *
     * Antes la ruta exigía sesión para todo, así que la única superficie cuyo
     * trabajo es explicar la plataforma a quien todavía no se ha unido pedía
     * autenticarse antes de enseñar nada.
     *
     * El acotado no se afloja: la identidad sigue saliendo del token verificado
     * y el cuerpo sigue sin poder llevar un identificador (§4.2). Sin token no
     * hay contexto personal que cargar, y punto.
     */
    const auth = await authenticate(request)
    const person = auth.ok ? await loadPersonContext(auth.supabase, auth.user.id) : null
    const docs = retrieve(question, locale)

    const tier = tierFor(question, (person?.tickets.length ?? 0) > 0)
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
    /*
     * Escalar exige alguien a quien responder.
     *
     * Un ticket sin destinatario no es una escalada, es una nota que nadie
     * puede contestar. Cuando una conversación sin sesión llega aquí se pide la
     * autenticación EN ESE MOMENTO —que es el punto de consecuencia— en vez de
     * abrir el ticket a nombre de nadie.
     */
    let needsSignIn = false
    if (reply.escalate) {
      if (auth.ok) {
        escalatedTo = await fileEscalationTicket(auth.supabase, auth.user.id, locale, [
          ...history,
          { role: 'user', text: question },
          { role: 'assistant', text: reply.text },
        ])
      } else {
        needsSignIn = true
      }
    }

    return NextResponse.json({
      text: reply.text,
      cta: reply.cta ?? null,
      escalatedTo,
      /** La escalada esperaba a una persona que todavía no tiene sesión. */
      needsSignIn,
      /** Tickets abiertos, para que el cliente pueda abrir con el más grave. */
      openTickets: person?.tickets ?? [],
      grounded: docs.length > 0,
    })
  } catch (error) {
    console.error('[assistant] failed:', error)
    return NextResponse.json({ error: 'assistant_failed' }, { status: 500 })
  }
}
