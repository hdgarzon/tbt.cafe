import { randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

/**
 * Hashing del código privado — Master Handoff §10.
 * scrypt de Node (sin dependencias nativas). Formato: scrypt$<salt-hex>$<hash-hex>.
 * SOLO servidor.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

const KEYLEN = 64

export async function hashCode(code: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync(code, salt, KEYLEN)
  return `scrypt$${salt}$${derived.toString('hex')}`
}

/** Verifica un código contra su hash en tiempo constante. */
export async function verifyCode(code: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const derived = await scryptAsync(code, salt, KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
