import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { PublicKey } from '@solana/web3.js'

/**
 * Chains 01, Stage 4.3 — holding addresses.
 *
 * The same title number always derives the same address; the address is
 * off-curve, so no key exists for it; the namespace itself is keyless and can
 * be re-derived by anyone from its published tag.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const libPath = join(root, 'src/lib/solana/holding.ts')

async function main() {
  ok('src/lib/solana/holding.ts exists', existsSync(libPath))
  if (!existsSync(libPath)) return
  const lib = await import(libPath)
  const src = readFileSync(libPath, 'utf8')

  // The namespace is the published tag's hash, and it is off the curve.
  const tagged = new PublicKey(createHash('sha256').update(lib.HOLDING_NAMESPACE_TAG).digest())
  ok('the namespace is the hash of its published tag', tagged.equals(lib.HOLDING_NAMESPACE))
  ok('the namespace is off-curve (no key exists for it)', !PublicKey.isOnCurve(lib.HOLDING_NAMESPACE.toBytes()))
  ok('the namespace is fixed in code, not read from the environment',
     !/HOLDING_NAMESPACE[\s\S]{0,120}process\.env/.test(src))

  // Deterministic and off-curve for every title number.
  const numbers = ['RRO5501-1', 'RRO5501-2', 'TST0001-1', 'ABC1234-17']
  for (let i = 0; i < numbers.length; i++) {
    const a: PublicKey = lib.holdingAddress(numbers[i])
    const b: PublicKey = lib.holdingAddress(numbers[i])
    ok(`${numbers[i]}: same number, same address`, a.equals(b))
    ok(`${numbers[i]}: off-curve`, !PublicKey.isOnCurve(a.toBytes()))
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('tbt-holding'), Buffer.from(numbers[i])], lib.HOLDING_NAMESPACE)
    ok(`${numbers[i]}: matches the published derivation`, a.equals(expected))
  }
  ok('different numbers, different addresses',
     !lib.holdingAddress('RRO5501-1').equals(lib.holdingAddress('RRO5501-2')))

  // A malformed title number is refused rather than silently derived.
  let refused = false
  try { lib.holdingAddress('RRO5501') } catch { refused = true }
  ok('a number without its owner index is refused', refused)

  // Mint and transfer name the holding address, never the payer — checked
  // once the Core token module exists (Stage 4.1 waits on test b).
  const tokenPath = join(root, 'src/lib/solana/token.ts')
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, 'utf8')
    ok('the mint owner is a holding address', /owner: holdingAddress\(/.test(token))
    ok('no transfer to the payer', !/newOwner: [^,\n]*payer/i.test(token))
  } else {
    console.log('skip mint/transfer owner checks — src/lib/solana/token.ts not yet written (Stage 4.1)')
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
