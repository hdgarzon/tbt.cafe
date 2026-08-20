import crypto from 'crypto'

/**
 * Generates a cryptographically secure transfer code in XXXX-XXXX format.
 * Uses an unambiguous character set (excludes I, O, 0, 1 to avoid confusion).
 */
export function generateTransferCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length]
    if (i === 3) code += '-'
  }
  return code
}
