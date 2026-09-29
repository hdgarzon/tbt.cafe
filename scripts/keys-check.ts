import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 7 — four keys, each with one job.
 *
 * Four distinct variables; the mint and the move never sign with the payer as
 * authority; uploads never sign with the authority key. And before a mint the
 * payer must hold enough for one (7.2.3): below it, no attempt.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

async function main() {
  const keys = await import(join(root, 'src/lib/solana/keys.ts'))
  const names: string[] = Object.values(keys.KEY_ENV)
  ok('four key variables', names.length === 4)
  ok('all four distinct', Array.from(new Set(names)).length === 4)
  ok('none is public', names.every((n) => !n.startsWith('NEXT_PUBLIC_')))

  // The same secret under two names is one key doing two jobs.
  const a = JSON.stringify(Array.from({ length: 64 }, (_, i) => i))
  const b = JSON.stringify(Array.from({ length: 64 }, (_, i) => 64 - i))
  let refused = false
  try { keys.assertDistinctSecrets({ payer: a, authority: a }) } catch { refused = true }
  ok('the same secret for payer and authority is refused', refused)
  let passed = true
  try { keys.assertDistinctSecrets({ payer: a, authority: b }) } catch { passed = false }
  ok('distinct secrets pass', passed)

  let preview = false
  const prev = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'preview'
  process.env[keys.KEY_ENV.authority] = a
  try { keys.readSecret('authority') } catch { preview = true }
  process.env.VERCEL_ENV = prev
  delete process.env[keys.KEY_ENV.authority]
  ok('a signing key is refused in a preview deployment', preview)

  const token = read('src/lib/solana/token.ts')
  ok('token.ts reads keys through keys.ts', /readSecret\('payer'\)/.test(token) && /readSecret\('authority'\)/.test(token))
  ok('token.ts reads no key variable directly', !/process\.env\.SOLANA_(PAYER|AUTHORITY)_PRIVATE_KEY|secretKeyFrom\('/.test(token))
  const authorities = token.match(/authority: [A-Za-z.]+/g) ?? []
  ok('every signer passed as authority is the authority key', authorities.length >= 3 && authorities.every((s) => s === 'authority: auth'))
  ok('connect refuses a payer that is the authority', /assertDistinctSecrets\(/.test(token))

  const arweave = read('src/lib/chain/arweave.ts')
  ok('uploads never touch the authority key', !/authority/i.test(arweave.replace(/\/\*[\s\S]*?\*\//g, '')))

  // 7.2.3 — the payer must afford one mint before it is attempted.
  ok('a minimum for one mint is declared', typeof keys.MIN_LAMPORTS_FOR_MINT === 'number' && keys.MIN_LAMPORTS_FOR_MINT >= 2_749_440)
  const mint = token.slice(token.indexOf('export async function mintTitleToken('), token.indexOf('export async function moveTitleToken('))
  const check = mint.indexOf('assertPayerCanMint(')
  ok('the mint checks the payer balance before creating', check > 0 && check < mint.indexOf('await create('))
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
