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
export function renderEmail(copy: EmailCopy, href: string | null): string {
  const button = href && copy.cta
    ? `<tr><td style="padding:26px 0 0"><a href="${href}" style="display:inline-block;background:#141312;color:#f4f2ef;text-decoration:none;font-size:13px;letter-spacing:.12em;text-transform:uppercase;padding:14px 26px;border-radius:10px">${copy.cta}</a></td></tr>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;background:#f4f2ef;padding:32px 16px;font-family:-apple-system,Segoe UI,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fbfaf8;border:1px solid #e3ded6;border-radius:16px">
<tr><td style="padding:34px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9c968c;padding-bottom:14px">tbt.cafe</td></tr>
<tr><td style="font-family:Georgia,serif;font-size:26px;line-height:1.15;color:#141312;padding-bottom:12px">${copy.heading}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#6b665f">${copy.body}</td></tr>
${button}
</table>
</td></tr>
</table>
<div style="max-width:520px;margin:16px auto 0;font-size:11.5px;color:#9c968c;line-height:1.5">
Puedes desactivar estos correos en Ajustes › Notificaciones. Las alertas de seguridad y de dinero no se pueden desactivar.
</div>
</body></html>`
}
