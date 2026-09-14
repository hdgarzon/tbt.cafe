/**
 * Plantillas de correo de notificación — Backend Spec 06 §1 y Spec 07 §4.2.
 *
 * El correo es alcance ADICIONAL: el feed dentro de la app es el canal de
 * registro y recibe todo pase lo que pase aquí. Por eso un fallo de correo no
 * puede tumbar nada — la persona ya se enteró.
 *
 * Se componen enteras por idioma, no por fragmentos. Una frase ensamblada de
 * trozos traducidos se lee como salida de máquina, y con la base vendedora en
 * Latinoamérica la mayoría de estos correos sale en español o portugués.
 *
 * Un evento sin plantilla NO se envía. El spec es explícito: no se publica
 * contenido incompleto y nunca se cae en silencio al inglés para alguien que
 * lee en español.
 */

export type Locale = 'en' | 'es' | 'pt' | 'fr'

export type EmailCopy = { subject: string; heading: string; body: string; cta?: string }

type Template = Record<Locale, (p: Record<string, string>) => EmailCopy>

const registrations: Template = {
  en: (p) => ({
    subject: `${p.title} is registered`,
    heading: 'Your work is on the record',
    body: `${p.title} was registered and is now verifiable.`,
    cta: 'See the work',
  }),
  es: (p) => ({
    subject: `${p.title} quedó registrada`,
    heading: 'Tu obra está en el registro',
    body: `${p.title} quedó registrada y ya se puede verificar.`,
    cta: 'Ver la obra',
  }),
  pt: (p) => ({
    subject: `${p.title} foi registrada`,
    heading: 'Sua obra está no registro',
    body: `${p.title} foi registrada e já pode ser verificada.`,
    cta: 'Ver a obra',
  }),
  fr: (p) => ({
    subject: `${p.title} est enregistrée`,
    heading: 'Votre œuvre est au registre',
    body: `${p.title} a été enregistrée et est désormais vérifiable.`,
    cta: "Voir l'œuvre",
  }),
}

const ticket_reply: Template = {
  en: (p) => ({
    subject: `The team replied to ${p.ref}`,
    heading: 'There is a reply waiting',
    body: `Someone from tbt.cafe answered your request "${p.subject}".`,
    cta: 'Read the reply',
  }),
  es: (p) => ({
    subject: `El equipo respondió a ${p.ref}`,
    heading: 'Tienes una respuesta',
    body: `Alguien de tbt.cafe respondió a tu solicitud «${p.subject}».`,
    cta: 'Leer la respuesta',
  }),
  pt: (p) => ({
    subject: `A equipe respondeu a ${p.ref}`,
    heading: 'Você tem uma resposta',
    body: `Alguém do tbt.cafe respondeu à sua solicitação "${p.subject}".`,
    cta: 'Ler a resposta',
  }),
  fr: (p) => ({
    subject: `L'équipe a répondu à ${p.ref}`,
    heading: 'Une réponse vous attend',
    body: `Quelqu'un de tbt.cafe a répondu à votre demande « ${p.subject} ».`,
    cta: 'Lire la réponse',
  }),
}

const ticket_system: Template = {
  en: (p) => ({
    subject: 'We opened a request for you',
    heading: 'We noticed something',
    body: `${p.subject} We opened a support request on your behalf — you do not need to report it.`,
    cta: 'See the request',
  }),
  es: (p) => ({
    subject: 'Abrimos una solicitud por ti',
    heading: 'Detectamos algo',
    body: `${p.subject} Abrimos una solicitud de soporte por ti — no hace falta que la reportes.`,
    cta: 'Ver la solicitud',
  }),
  pt: (p) => ({
    subject: 'Abrimos uma solicitação para você',
    heading: 'Detectamos algo',
    body: `${p.subject} Abrimos uma solicitação de suporte para você — não precisa reportar.`,
    cta: 'Ver a solicitação',
  }),
  fr: (p) => ({
    subject: 'Nous avons ouvert une demande pour vous',
    heading: 'Nous avons remarqué quelque chose',
    body: `${p.subject} Nous avons ouvert une demande d'assistance pour vous — inutile de la signaler.`,
    cta: 'Voir la demande',
  }),
}

/**
 * Cambio de destino de cobro — una de las protectoras (§5.3), que no se apagan.
 *
 * El feed solo no basta: quien cambió el destino puede ser quien tiene la sesión
 * abierta, y es quien ve el feed. El correo llega a la dirección de la cuenta.
 * `to` y `from` los calcula el servidor a partir del destino completo; lo que
 * mande el navegador no entra en este HTML.
 */
const payout_destination: Template = {
  en: (p) => ({
    subject: 'Your payout destination was changed',
    heading: 'Where you get paid changed',
    body: `Payouts now go to ${p.to}.${p.from ? ` This replaces ${p.from}.` : ''} If you made this change, there is nothing to do. If you did not, treat it as urgent and open a help request right away.`,
    cta: 'Open a help request',
  }),
  es: (p) => ({
    subject: 'Cambió el destino de tus cobros',
    heading: 'Cambió a dónde te pagamos',
    body: `Tus cobros ahora van a ${p.to}.${p.from ? ` Reemplaza a ${p.from}.` : ''} Si hiciste tú este cambio, no tienes que hacer nada. Si no fuiste tú, trátalo como urgente y abre una solicitud de ayuda de inmediato.`,
    cta: 'Abrir una solicitud de ayuda',
  }),
  pt: (p) => ({
    subject: 'O destino dos seus recebimentos mudou',
    heading: 'Mudou para onde pagamos você',
    body: `Seus recebimentos agora vão para ${p.to}.${p.from ? ` Substitui ${p.from}.` : ''} Se foi você quem fez essa mudança, não precisa fazer nada. Se não foi, trate como urgente e abra uma solicitação de ajuda imediatamente.`,
    cta: 'Abrir uma solicitação de ajuda',
  }),
  fr: (p) => ({
    subject: 'La destination de vos versements a changé',
    heading: "L'endroit où nous vous payons a changé",
    body: `Vos versements vont désormais vers ${p.to}.${p.from ? ` Elle remplace ${p.from}.` : ''} Si vous avez fait ce changement, vous n'avez rien à faire. Sinon, considérez-le comme urgent et ouvrez une demande d'assistance immédiatement.`,
    cta: "Ouvrir une demande d'assistance",
  }),
}

/**
 * Cobro completado. "Enviado" quiere decir lo que `disburseBlock` puede afirmar:
 * que la transferencia llegó al saldo de Stripe de la persona. De ahí al banco
 * lo lleva Stripe con su calendario, y el correo no promete más.
 */
const payout_completed: Template = {
  en: (p) => ({
    subject: `Your payout of ${p.amount} USD was sent`,
    heading: 'Your payout is on its way',
    body: `${p.amount} USD from payout block ${p.block} reached your Stripe balance. Stripe sends it on to your bank account or wallet on its own schedule.`,
    cta: 'See your payouts',
  }),
  es: (p) => ({
    subject: `Enviamos tu cobro de ${p.amount} USD`,
    heading: 'Tu cobro va en camino',
    body: `${p.amount} USD del bloque de cobro ${p.block} llegaron a tu saldo de Stripe. Stripe los envía a tu cuenta bancaria o billetera según su propio calendario.`,
    cta: 'Ver tus cobros',
  }),
  pt: (p) => ({
    subject: `Enviamos seu recebimento de ${p.amount} USD`,
    heading: 'Seu recebimento está a caminho',
    body: `${p.amount} USD do bloco de recebimento ${p.block} chegaram ao seu saldo na Stripe. A Stripe os envia para sua conta bancária ou carteira no próprio calendário.`,
    cta: 'Ver seus recebimentos',
  }),
  fr: (p) => ({
    subject: `Votre versement de ${p.amount} USD a été envoyé`,
    heading: 'Votre versement est en route',
    body: `${p.amount} USD du bloc de versement ${p.block} sont arrivés sur votre solde Stripe. Stripe les transfère vers votre compte bancaire ou votre portefeuille selon son propre calendrier.`,
    cta: 'Voir vos versements',
  }),
}

/**
 * Cobro fallido — protectora, no se apaga. Lo primero que hay que decir es que
 * el dinero no se perdió: `fail_payout_block` devuelve las ganancias a
 * disponible. Si el motivo es que la cuenta de cobro no está lista, se dice qué
 * hacer; un código del proveedor no le sirve a nadie.
 */
const NEEDS_SETUP = ['no_connect_account', 'transfers_not_enabled']

const payout_failed: Template = {
  en: (p) => ({
    subject: `Your payout of ${p.amount} USD did not go through`,
    heading: 'Your payout was not completed',
    body: `Payout block ${p.block} did not reach its destination. The ${p.amount} USD is back in your available balance, so nothing is lost and you can collect it again.${NEEDS_SETUP.includes(p.reason) ? ' Your payout account is not ready to receive money yet: finish setting it up in Settings, then collect again.' : ''}`,
    cta: 'See your payouts',
  }),
  es: (p) => ({
    subject: `Tu cobro de ${p.amount} USD no se completó`,
    heading: 'No pudimos completar tu cobro',
    body: `El bloque de cobro ${p.block} no llegó a su destino. Los ${p.amount} USD volvieron a tu saldo disponible: no se perdió nada y puedes cobrarlos otra vez.${NEEDS_SETUP.includes(p.reason) ? ' Tu cuenta de cobro aún no está lista para recibir dinero: termina de configurarla en Ajustes y vuelve a cobrar.' : ''}`,
    cta: 'Ver tus cobros',
  }),
  pt: (p) => ({
    subject: `Seu recebimento de ${p.amount} USD não foi concluído`,
    heading: 'Não conseguimos concluir seu recebimento',
    body: `O bloco de recebimento ${p.block} não chegou ao destino. Os ${p.amount} USD voltaram ao seu saldo disponível: nada foi perdido e você pode receber de novo.${NEEDS_SETUP.includes(p.reason) ? ' Sua conta de recebimento ainda não está pronta para receber dinheiro: termine a configuração em Ajustes e tente de novo.' : ''}`,
    cta: 'Ver seus recebimentos',
  }),
  fr: (p) => ({
    subject: `Votre versement de ${p.amount} USD n'a pas abouti`,
    heading: "Votre versement n'a pas été effectué",
    body: `Le bloc de versement ${p.block} n'est pas arrivé à destination. Les ${p.amount} USD sont revenus sur votre solde disponible : rien n'est perdu et vous pouvez les percevoir à nouveau.${NEEDS_SETUP.includes(p.reason) ? " Votre compte de versement n'est pas encore prêt à recevoir de l'argent : terminez sa configuration dans Réglages, puis réessayez." : ''}`,
    cta: 'Voir vos versements',
  }),
}

/**
 * Compras y transferencias: un evento, varias cosas que pueden haber pasado.
 * `variant` elige cuál; una variante desconocida cae en un texto neutro antes que
 * afirmar algo que no ocurrió.
 *
 * Ninguna promete dinero al vendedor: en una venta el precio cambia de manos
 * fuera de la plataforma, y lo único que se anota es la regalía del creador.
 */
const pick = (variants: Record<string, EmailCopy>, variant: string, neutral: EmailCopy): EmailCopy =>
  variants[variant] ?? neutral

const purchases: Template = {
  en: (p) => pick({
    bought: { subject: `You bought “${p.title}”`, heading: 'It is yours now', body: `The purchase of “${p.title}” went through, and you are now its holder.`, cta: 'See the work' },
    sold: { subject: `“${p.title}” sold`, heading: 'Your work changed hands', body: `“${p.title}” was bought and now has a new holder.`, cta: 'See the work' },
  }, p.variant, { subject: `An update on “${p.title}”`, heading: 'A purchase completed', body: `There is an update on “${p.title}”.`, cta: 'See the work' }),
  es: (p) => pick({
    bought: { subject: `Compraste «${p.title}»`, heading: 'Ya es tuya', body: `La compra de «${p.title}» se completó y ahora eres quien la tiene.`, cta: 'Ver la obra' },
    sold: { subject: `Se vendió «${p.title}»`, heading: 'Tu obra cambió de manos', body: `Compraron «${p.title}» y ahora tiene un nuevo dueño.`, cta: 'Ver la obra' },
  }, p.variant, { subject: `Novedades de «${p.title}»`, heading: 'Se completó una compra', body: `Hay novedades sobre «${p.title}».`, cta: 'Ver la obra' }),
  pt: (p) => pick({
    bought: { subject: `Você comprou “${p.title}”`, heading: 'Agora é sua', body: `A compra de “${p.title}” foi concluída e agora você é quem a detém.`, cta: 'Ver a obra' },
    sold: { subject: `“${p.title}” foi vendida`, heading: 'Sua obra mudou de mãos', body: `Compraram “${p.title}” e agora ela tem um novo dono.`, cta: 'Ver a obra' },
  }, p.variant, { subject: `Novidades sobre “${p.title}”`, heading: 'Uma compra foi concluída', body: `Há novidades sobre “${p.title}”.`, cta: 'Ver a obra' }),
  fr: (p) => pick({
    bought: { subject: `Vous avez acheté « ${p.title} »`, heading: 'Elle est à vous', body: `L'achat de « ${p.title} » est finalisé : vous en êtes désormais le détenteur.`, cta: "Voir l'œuvre" },
    sold: { subject: `« ${p.title} » a été vendue`, heading: 'Votre œuvre a changé de mains', body: `« ${p.title} » a été achetée et a désormais un nouveau détenteur.`, cta: "Voir l'œuvre" },
  }, p.variant, { subject: `Du nouveau pour « ${p.title} »`, heading: 'Un achat a été finalisé', body: `Il y a du nouveau pour « ${p.title} ».`, cta: "Voir l'œuvre" }),
}

const transfers: Template = {
  en: (p) => pick({
    received: { subject: `“${p.title}” is yours now`, heading: 'The transfer went through', body: `The transfer of “${p.title}” is complete, and you are now its holder.`, cta: 'See the work' },
    accepted: { subject: `Your transfer of “${p.title}” was accepted`, heading: 'The transfer went through', body: `The recipient accepted “${p.title}”. The work has a new holder, and the amount held on your card was charged.`, cta: 'See the work' },
    declined: { subject: `Your transfer of “${p.title}” was declined`, heading: 'The transfer did not go ahead', body: `The recipient declined “${p.title}”. The hold on your card was released and nothing was charged. The work is still yours.`, cta: 'See the work' },
    lapsed: { subject: `Your transfer of “${p.title}” expired`, heading: 'It was not accepted in time', body: `“${p.title}” was not accepted within 24 hours, so the hold on your card was released and nothing was charged. The work is still yours, and you can send the transfer again.`, cta: 'See the work' },
  }, p.variant, { subject: `An update on “${p.title}”`, heading: 'A transfer changed', body: `There is an update on the transfer of “${p.title}”.`, cta: 'See the work' }),
  es: (p) => pick({
    received: { subject: `«${p.title}» ya es tuya`, heading: 'La transferencia se completó', body: `La transferencia de «${p.title}» se completó y ahora eres quien la tiene.`, cta: 'Ver la obra' },
    accepted: { subject: `Aceptaron tu transferencia de «${p.title}»`, heading: 'La transferencia se completó', body: `Quien la recibe aceptó «${p.title}». La obra tiene un nuevo dueño y se cobró el monto que estaba retenido en tu tarjeta.`, cta: 'Ver la obra' },
    declined: { subject: `Rechazaron tu transferencia de «${p.title}»`, heading: 'La transferencia no siguió', body: `Quien la iba a recibir rechazó «${p.title}». Se liberó la retención de tu tarjeta y no se cobró nada. La obra sigue siendo tuya.`, cta: 'Ver la obra' },
    lapsed: { subject: `Venció tu transferencia de «${p.title}»`, heading: 'No se aceptó a tiempo', body: `«${p.title}» no se aceptó dentro de las 24 horas, así que se liberó la retención de tu tarjeta y no se cobró nada. La obra sigue siendo tuya y puedes enviar la transferencia de nuevo.`, cta: 'Ver la obra' },
  }, p.variant, { subject: `Novedades de «${p.title}»`, heading: 'Cambió una transferencia', body: `Hay novedades sobre la transferencia de «${p.title}».`, cta: 'Ver la obra' }),
  pt: (p) => pick({
    received: { subject: `“${p.title}” agora é sua`, heading: 'A transferência foi concluída', body: `A transferência de “${p.title}” foi concluída e agora você é quem a detém.`, cta: 'Ver a obra' },
    accepted: { subject: `Sua transferência de “${p.title}” foi aceita`, heading: 'A transferência foi concluída', body: `Quem recebe aceitou “${p.title}”. A obra tem um novo dono e o valor retido no seu cartão foi cobrado.`, cta: 'Ver a obra' },
    declined: { subject: `Sua transferência de “${p.title}” foi recusada`, heading: 'A transferência não seguiu', body: `Quem ia receber recusou “${p.title}”. A retenção no seu cartão foi liberada e nada foi cobrado. A obra continua sendo sua.`, cta: 'Ver a obra' },
    lapsed: { subject: `Sua transferência de “${p.title}” expirou`, heading: 'Não foi aceita a tempo', body: `“${p.title}” não foi aceita em 24 horas, então a retenção no seu cartão foi liberada e nada foi cobrado. A obra continua sendo sua e você pode enviar a transferência de novo.`, cta: 'Ver a obra' },
  }, p.variant, { subject: `Novidades sobre “${p.title}”`, heading: 'Uma transferência mudou', body: `Há novidades sobre a transferência de “${p.title}”.`, cta: 'Ver a obra' }),
  fr: (p) => pick({
    received: { subject: `« ${p.title} » est à vous`, heading: 'Le transfert est finalisé', body: `Le transfert de « ${p.title} » est finalisé : vous en êtes désormais le détenteur.`, cta: "Voir l'œuvre" },
    accepted: { subject: `Votre transfert de « ${p.title} » a été accepté`, heading: 'Le transfert est finalisé', body: `Le destinataire a accepté « ${p.title} ». L'œuvre a un nouveau détenteur et le montant bloqué sur votre carte a été débité.`, cta: "Voir l'œuvre" },
    declined: { subject: `Votre transfert de « ${p.title} » a été refusé`, heading: "Le transfert n'a pas abouti", body: `Le destinataire a refusé « ${p.title} ». Le blocage sur votre carte a été levé et rien n'a été prélevé. L'œuvre est toujours à vous.`, cta: "Voir l'œuvre" },
    lapsed: { subject: `Votre transfert de « ${p.title} » a expiré`, heading: "Il n'a pas été accepté à temps", body: `« ${p.title} » n'a pas été accepté dans les 24 heures : le blocage sur votre carte a été levé et rien n'a été prélevé. L'œuvre est toujours à vous et vous pouvez renvoyer le transfert.`, cta: "Voir l'œuvre" },
  }, p.variant, { subject: `Du nouveau pour « ${p.title} »`, heading: 'Un transfert a changé', body: `Il y a du nouveau pour le transfert de « ${p.title} ».`, cta: "Voir l'œuvre" }),
}

/**
 * Solo los eventos con plantilla completa en los cuatro idiomas. Añadir uno
 * aquí sin sus cuatro traducciones es lo que el spec prohíbe.
 */
const TEMPLATES: Record<string, Template> = {
  registrations,
  ticket_reply,
  ticket_system,
  payout_destination,
  payout_completed,
  payout_failed,
  purchases,
  transfers,
}

export function emailCopyFor(
  eventKey: string,
  locale: Locale,
  params: Record<string, string>
): EmailCopy | null {
  const t = TEMPLATES[eventKey]
  if (!t) return null
  return t[locale](params)
}

/**
 * Envoltura HTML. Papel y tinta de la casa, sin imágenes remotas ni fuentes
 * externas: los clientes de correo bloquean casi todo eso y una plantilla que
 * depende de ello llega rota.
 */
/**
 * Todo lo que entra en el HTML se escapa. Los parámetros de las plantillas llevan
 * texto de personas —el título de una obra lo escribe su creador, el asunto de un
 * ticket lo escribe quien lo abre— y, sin esto, cualquiera metía su propio enlace
 * en el correo que recibe otra persona. Las plantillas son texto plano: no hay
 * nada que escapar que debiera haberse quedado como etiqueta.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderEmail(copy: EmailCopy, href: string | null): string {
  const button = href && copy.cta
    ? `<tr><td style="padding:26px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#141312;color:#f4f2ef;text-decoration:none;font-size:13px;letter-spacing:.12em;text-transform:uppercase;padding:14px 26px;border-radius:10px">${escapeHtml(copy.cta)}</a></td></tr>`
    : ''
  const heading = escapeHtml(copy.heading)
  const body = escapeHtml(copy.body)

  return `<!doctype html>
<html><body style="margin:0;background:#f4f2ef;padding:32px 16px;font-family:-apple-system,Segoe UI,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fbfaf8;border:1px solid #e3ded6;border-radius:16px">
<tr><td style="padding:34px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9c968c;padding-bottom:14px">tbt.cafe</td></tr>
<tr><td style="font-family:Georgia,serif;font-size:26px;line-height:1.15;color:#141312;padding-bottom:12px">${heading}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#6b665f">${body}</td></tr>
${button}
</table>
</td></tr>
</table>
<div style="max-width:520px;margin:16px auto 0;font-size:11.5px;color:#9c968c;line-height:1.5">
Puedes desactivar estos correos en Ajustes › Notificaciones. Las alertas de seguridad y de dinero no se pueden desactivar.
</div>
</body></html>`
}
