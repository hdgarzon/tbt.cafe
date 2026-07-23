/**
 * Enmascarado de valores sensibles — Master Handoff §14.
 * "Nunca renderizar secretos completos."
 *
 *   teléfono → código de marcación + últimos 4
 *   email    → primer carácter + dominio
 */

/** Enmascara un teléfono en E.164 (p.ej. "573207145752" → "+57 ••• ••• 5752"). */
export function maskPhoneE164(e164: string): string {
  const clean = e164.replace(/\D/g, '')
  if (clean.length < 5) return '•••'
  const last4 = clean.slice(-4)
  // El resto se asume código de país; se muestran hasta 3 dígitos de marcación.
  const dial = clean.slice(0, Math.max(1, clean.length - 10)) || clean.slice(0, 2)
  return `+${dial} ••• ••• ${last4}`
}

/** Enmascara un email (p.ej. "henry@gmail.com" → "h•••@gmail.com"). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '•••'
  return `${local.slice(0, 1)}•••@${domain}`
}
