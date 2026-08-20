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
    body: `${p.title} was registered and is now verifiable. Its certificate and transfer key were sent to your phone.`,
    cta: 'See the work',
  }),
  es: (p) => ({
    subject: `${p.title} quedó registrada`,
    heading: 'Tu obra está en el registro',
    body: `${p.title} quedó registrada y ya se puede verificar. Su certificado y su llave de transferencia se enviaron a tu teléfono.`,
    cta: 'Ver la obra',
  }),
  pt: (p) => ({
    subject: `${p.title} foi registrada`,
    heading: 'Sua obra está no registro',
    body: `${p.title} foi registrada e já pode ser verificada. O certificado e a chave de transferência foram enviados para o seu telefone.`,
    cta: 'Ver a obra',
  }),
  fr: (p) => ({
    subject: `${p.title} est enregistrée`,
    heading: 'Votre œuvre est au registre',
    body: `${p.title} a été enregistrée et est désormais vérifiable. Son certificat et sa clé de transfert ont été envoyés à votre téléphone.`,
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
 * Solo los eventos con plantilla completa en los cuatro idiomas. Añadir uno
 * aquí sin sus cuatro traducciones es lo que el spec prohíbe.
 */
const TEMPLATES: Record<string, Template> = {
  registrations,
  ticket_reply,
  ticket_system,
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
