/**
 * Tickets de sistema — Backend Spec 03 §1.2.
 *
 * Un evento que la plataforma DETECTA. Aquí el sistema lo sabe todo:
 * identificadores, marcas de tiempo, el fallo exacto. El ticket llega completo
 * y normalmente antes de que el cliente lo note; nunca se le pide que aporte lo
 * que ya sabemos.
 *
 * El texto se escribe PARA EL CLIENTE. Un código de error del proveedor va en
 * `context.error_detail`, jamás en el asunto: la persona lee "No pudimos
 * entregar tu certificado", no una traza.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/notify'
import { createAdminClient } from '@/lib/supabase-admin'

export type TicketCategory =
  | 'payments'
  | 'payouts'
  | 'transfers'
  | 'registration'
  | 'authentication'
  | 'other'

export type SystemEventCode =
  | 'mms_delivery_failed'
  | 'solana_registration_failed'
  | 'payment_capture_failed'
  | 'payout_failed'

type Locale = 'en' | 'es' | 'pt' | 'fr'

type Template = { category: TicketCategory; severity: 'financial' | 'secondary'; copy: Record<Locale, { subject: string; body: string }> }

/**
 * Plantillas por evento, en los cuatro idiomas. Se componen enteras y no por
 * fragmentos: una frase ensamblada de trozos traducidos se lee como una
 * traducción automática, y con la base vendedora en Latinoamérica buena parte
 * de estos tickets sale en español o portugués.
 */
const TEMPLATES: Record<SystemEventCode, Template> = {
  /**
   * Severidad financiera aunque no mueva dinero: el certificado y la llave son
   * el producto, se entregan solo por MMS y no se muestran nunca en pantalla.
   * Una entrega fallida significa que el cliente pagó y no recibió nada.
   */
  mms_delivery_failed: {
    category: 'registration',
    severity: 'financial',
    copy: {
      en: {
        subject: 'We could not deliver your certificate',
        body: 'Your work was registered, but the message carrying its certificate and key did not reach your number. Nothing is lost — we are on it and will resend it. Reply here if your number has changed.',
      },
      es: {
        subject: 'No pudimos entregar tu certificado',
        body: 'Tu obra quedó registrada, pero el mensaje con su certificado y su llave no llegó a tu número. No se perdió nada: estamos en ello y lo reenviaremos. Responde aquí si cambiaste de número.',
      },
      pt: {
        subject: 'Não conseguimos entregar seu certificado',
        body: 'Sua obra foi registrada, mas a mensagem com o certificado e a chave não chegou ao seu número. Nada foi perdido — já estamos cuidando disso e vamos reenviar. Responda aqui se o seu número mudou.',
      },
      fr: {
        subject: "Nous n'avons pas pu livrer votre certificat",
        body: "Votre œuvre a bien été enregistrée, mais le message contenant son certificat et sa clé n'est pas arrivé à votre numéro. Rien n'est perdu : nous nous en occupons et le renverrons. Répondez ici si votre numéro a changé.",
      },
    },
  },

  solana_registration_failed: {
    category: 'registration',
    severity: 'secondary',
    copy: {
      en: {
        subject: 'Your work is registered, the chain record is still pending',
        body: 'Your work and its certificate are safe. Writing its record to the chain has not confirmed yet. We are retrying and will let you know when it settles — you do not need to do anything.',
      },
      es: {
        subject: 'Tu obra está registrada; el asiento en cadena sigue pendiente',
        body: 'Tu obra y su certificado están a salvo. La escritura del registro en la cadena todavía no confirma. Estamos reintentando y te avisamos cuando cierre; no tienes que hacer nada.',
      },
      pt: {
        subject: 'Sua obra está registrada; o registro na cadeia ainda está pendente',
        body: 'Sua obra e seu certificado estão seguros. A gravação do registro na cadeia ainda não confirmou. Estamos tentando novamente e avisaremos quando concluir — você não precisa fazer nada.',
      },
      fr: {
        subject: "Votre œuvre est enregistrée, l'inscription sur la chaîne est en attente",
        body: "Votre œuvre et son certificat sont en sécurité. L'inscription du registre sur la chaîne n'est pas encore confirmée. Nous réessayons et vous préviendrons dès que ce sera fait — vous n'avez rien à faire.",
      },
    },
  },

  payment_capture_failed: {
    category: 'payments',
    severity: 'financial',
    copy: {
      en: {
        subject: 'A payment could not be completed',
        body: 'A payment on your account did not go through. No funds were taken. Reply here and we will sort it out with you.',
      },
      es: {
        subject: 'No se pudo completar un pago',
        body: 'Un pago tuyo no se completó. No se cobró nada. Responde aquí y lo resolvemos contigo.',
      },
      pt: {
        subject: 'Um pagamento não pôde ser concluído',
        body: 'Um pagamento seu não foi concluído. Nada foi cobrado. Responda aqui e resolvemos com você.',
      },
      fr: {
        subject: "Un paiement n'a pas pu être finalisé",
        body: "Un de vos paiements n'a pas abouti. Aucun montant n'a été prélevé. Répondez ici et nous réglerons cela avec vous.",
      },
    },
  },

  payout_failed: {
    category: 'payouts',
    severity: 'financial',
    copy: {
      en: {
        subject: 'Your payout could not be completed',
        body: 'The payout you collected did not reach its destination. Your money is not lost — it is still with us while we resolve this. Reply here if you want to change the destination.',
      },
      es: {
        subject: 'No pudimos completar tu cobro',
        body: 'El cobro que solicitaste no llegó a su destino. Tu dinero no se perdió: sigue con nosotros mientras lo resolvemos. Responde aquí si quieres cambiar el destino.',
      },
      pt: {
        subject: 'Não conseguimos concluir seu recebimento',
        body: 'O valor que você solicitou não chegou ao destino. Seu dinheiro não foi perdido — continua conosco enquanto resolvemos. Responda aqui se quiser mudar o destino.',
      },
      fr: {
        subject: "Votre versement n'a pas pu être effectué",
        body: "Le versement que vous avez demandé n'est pas arrivé à destination. Votre argent n'est pas perdu : il reste chez nous le temps que nous réglions cela. Répondez ici si vous souhaitez changer la destination.",
      },
    },
  },
}

const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']

async function localeFor(supabase: SupabaseClient, userId: string): Promise<Locale> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('language_override')
      .eq('id', userId)
      .single()
    const override = data?.language_override as string | null
    const hit = LOCALES.find((l) => l === override)
    // El servidor no ve el idioma que la app detecta del navegador, así que sin
    // preferencia explícita queda el mismo respaldo que usa el resto: inglés.
    return hit ?? 'en'
  } catch {
    return 'en'
  }
}

/**
 * Abre un ticket de sistema, o añade contexto al que ya existe.
 *
 * Es IDEMPOTENTE por `(entity_type, entity_id, event_code)`: un payout que
 * reintenta y falla tres veces es un ticket con tres entradas de contexto, no
 * tres tickets. Lo garantiza un índice único parcial sobre los estados
 * abiertos, así que un fallo nuevo tras cerrar el anterior sí abre uno nuevo.
 *
 * Nunca lanza: un fallo abriendo el ticket de un fallo no puede tumbar la
 * operación que lo detectó.
 */
export async function fileSystemTicket(
  _client: SupabaseClient,
  params: {
    userId: string
    eventCode: SystemEventCode
    entityType: 'payout_block' | 'transfer' | 'work' | 'payment_intent' | 'registration'
    entityId: string
    errorDetail?: unknown
  }
): Promise<void> {
  const { userId, eventCode, entityType, entityId, errorDetail } = params
  const template = TEMPLATES[eventCode]
  if (!template) return

  try {
    // La política de `tickets` solo deja al cliente abrir los suyos y de origen
    // 'human'. Un ticket de sistema lo escribe la plataforma.
    const supabase = createAdminClient()
    const locale = await localeFor(supabase, userId)
    const copy = template.copy[locale]

    const { error } = await supabase.from('tickets').insert({
      origin: 'system',
      category: template.category,
      severity: template.severity,
      subject: copy.subject,
      body: copy.body,
      subject_user: userId,
      context: {
        entity_type: entityType,
        entity_id: entityId,
        event_code: eventCode,
        // El detalle técnico vive aquí, nunca en el asunto.
        error_detail: errorDetail ? JSON.parse(JSON.stringify(errorDetail)) : null,
        occurred_at: new Date().toISOString(),
      },
    })

    // 23505 = choque con el índice de deduplicación: ya hay un ticket abierto
    // para este mismo fallo. Se le añade el intento como contexto en vez de
    // duplicarlo.
    if (error?.code === '23505') {
      const { data: existing } = await supabase
        .from('tickets')
        .select('id, context')
        .eq('origin', 'system')
        .eq('subject_user', userId)
        .contains('context', { entity_id: entityId, event_code: eventCode })
        .in('status', ['open', 'answered'])
        .single()

      if (existing) {
        const ctx = (existing.context ?? {}) as Record<string, unknown>
        const attempts = Array.isArray(ctx.attempts) ? (ctx.attempts as unknown[]) : []
        attempts.push({
          at: new Date().toISOString(),
          error_detail: errorDetail ? JSON.parse(JSON.stringify(errorDetail)) : null,
        })
        await supabase
          .from('tickets')
          .update({ context: { ...ctx, attempts }, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      }
      return
    }

    if (error) {
      console.error('[system-ticket] insert failed:', eventCode, error)
      return
    }

    // Lo que afecta al dinero o al certificado se cuenta pronto (§7). Este
    // aviso no se puede silenciar, así que no se consulta la preferencia.
    await notify(supabase, {
      userId,
      eventKey: 'ticket_system',
      data: { subject: copy.subject, severity: template.severity },
      href: '/help',
    })
  } catch (err) {
    console.error('[system-ticket] unexpected failure:', eventCode, err)
  }
}
