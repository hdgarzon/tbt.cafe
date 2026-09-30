import { createHash, randomInt } from 'crypto'
import type { EmailCopy, Locale } from '@/lib/email-templates'

/**
 * El código que verifica el e-Mail — Work Order 01 Step 19.
 *
 * Seis dígitos, caduca a los 10 minutos, 5 intentos. Se guarda solo su hash,
 * atado a la persona y a la solicitud: el mismo código en otra solicitud no
 * produce el mismo hash.
 *
 * TEXTO EN BORRADOR: el Set 3 no trae el correo que lleva el código. Estas
 * cuatro versiones esperan la aprobación de Federico; no se publican sin ella.
 */

export const CODE_TTL_MINUTES = 10
export const CODE_MAX_ATTEMPTS = 5
export const CODE_MAX_PER_HOUR = 5

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(code: string, userId: string, requestId: string): string {
  return createHash('sha256').update(`tbt-email-code:${userId}:${requestId}:${code}`).digest('hex')
}

const COPY: Record<Locale, (code: string) => EmailCopy> = {
  en: (code) => ({
    subject: `Your tbt.cafe code: ${code}`,
    heading: 'Verify your e-Mail',
    body: `Your code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for it, you can ignore this e-Mail.`,
  }),
  es: (code) => ({
    subject: `Tu código de tbt.cafe: ${code}`,
    heading: 'Verifica tu e-Mail',
    body: `Tu código es ${code}. Caduca en ${CODE_TTL_MINUTES} minutos. Si no lo pediste, puedes ignorar este correo.`,
  }),
  pt: (code) => ({
    subject: `Seu código do tbt.cafe: ${code}`,
    heading: 'Verifique seu e-mail',
    body: `Seu código é ${code}. Ele expira em ${CODE_TTL_MINUTES} minutos. Se você não o pediu, pode ignorar este e-mail.`,
  }),
  fr: (code) => ({
    subject: `Votre code tbt.cafe : ${code}`,
    heading: 'Vérifiez votre e-mail',
    body: `Votre code est ${code}. Il expire dans ${CODE_TTL_MINUTES} minutes. Si vous ne l’avez pas demandé, ignorez cet e-mail.`,
  }),
}

export function codeEmail(locale: Locale, code: string): EmailCopy {
  return COPY[locale](code)
}
