/**
 * Escalada del asistente a una persona — Backend Spec 04 §5.4 y §6.
 *
 * Cuando el asistente no puede resolver —incluido cuando simplemente no sabe—
 * abre un ticket `ai_escalation` que LLEVA LA TRANSCRIPCIÓN. Esto no es
 * negociable: la experiencia de soporte más corrosiva es tener que explicar el
 * mismo problema dos veces. Si el asistente ya recogió los detalles, viajan con
 * la escalada.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type Locale = 'en' | 'es' | 'pt' | 'fr'

type Turn = { role: 'user' | 'assistant'; text: string }

const SUBJECT: Record<Locale, string> = {
  en: 'A question the assistant could not answer',
  es: 'Una consulta que el asistente no pudo resolver',
  pt: 'Uma dúvida que o assistente não conseguiu resolver',
  fr: "Une question à laquelle l'assistant n'a pas pu répondre",
}

const INTRO: Record<Locale, string> = {
  en: 'The assistant could not resolve this, so a person will pick it up. The conversation is attached — you will not have to explain it again.',
  es: 'El asistente no pudo resolverlo, así que lo retoma una persona. La conversación va adjunta: no tendrás que explicarlo otra vez.',
  pt: 'O assistente não conseguiu resolver, então uma pessoa vai assumir. A conversa está anexada — você não vai precisar explicar de novo.',
  fr: "L'assistant n'a pas pu résoudre cela, une personne va prendre le relais. La conversation est jointe — vous n'aurez pas à l'expliquer à nouveau.",
}

/**
 * Abre la escalada y devuelve su referencia legible, o null si no se pudo.
 *
 * Nunca lanza: si el ticket falla, la persona igualmente recibe la respuesta
 * honesta de que no se sabe. Perder la escalada es malo; tumbar la conversación
 * encima es peor.
 */
export async function fileEscalationTicket(
  supabase: SupabaseClient,
  userId: string,
  locale: Locale,
  transcript: Turn[]
): Promise<string | null> {
  try {
    // La primera pregunta de la persona resume mejor el caso que cualquier
    // etiqueta que pudiéramos inventar.
    const firstQuestion = transcript.find((t) => t.role === 'user')?.text ?? ''
    const subject = firstQuestion ? firstQuestion.slice(0, 120) : SUBJECT[locale]

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        origin: 'ai_escalation',
        // Sin diagnóstico fiable no se adivina la categoría: 'other' es honesto
        // y el equipo la corrige en la cola.
        category: 'other',
        severity: 'secondary',
        subject,
        body: `${INTRO[locale]}\n\n---\n\n${transcript
          .map((t) => `${t.role === 'user' ? '>' : '·'} ${t.text}`)
          .join('\n\n')}`,
        subject_user: userId,
        context: { transcript },
      })
      .select('ref')
      .single()

    if (error) {
      console.error('[assistant] escalation failed:', error)
      return null
    }
    return data?.ref ?? null
  } catch (err) {
    console.error('[assistant] escalation threw:', err)
    return null
  }
}
