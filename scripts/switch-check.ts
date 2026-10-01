import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 11 — the switch is prepared, and nothing in the preparation
 * can switch by itself.
 *
 * The readiness route only reads: it reports what is set and what is missing,
 * with public addresses and never a secret. The collection script creates the
 * mainnet collection once, and only when asked for the network it is pointed
 * at. The runbook carries 11.1–11.8 in order.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const route = code(read('src/app/api/cron/switch-readiness/route.ts'))
ok('the readiness route exists', route.length > 0)
ok('it needs CRON_SECRET', /if \(!secret \|\| request\.headers\.get\('authorization'\) !== `Bearer \$\{secret\}`\)/.test(route))
ok('it only reads', !/\.insert\(|\.update\(|\.delete\(|\.upsert\(|sendAndConfirm|\.rpc\(/.test(route))
ok('it reports public addresses, never a secret', /\.slice\(32, 64\)/.test(route) && !/detail: (raw|secret|process\.env\[)/.test(route))
ok('it checks the network', /SOLANA_NETWORK === 'mainnet-beta'/.test(route))
ok('it checks the four keys are distinct', /assertDistinctSecrets\(/.test(route))
ok('it checks the collection is a Core account', /MPL_CORE_PROGRAM/.test(route))
ok('it checks the working balance', /WORKING_BALANCE_LAMPORTS = 1_000_000_000/.test(route))
ok('it checks the test data is gone', /from\('works'\)/.test(route) && /from\('image_vectors'\)/.test(route))
ok('it checks the reserved IDs', /tbt_id_reserved/.test(route))

const script = code(read('scripts/create-title-collection.ts'))
ok('the collection script exists', script.length > 0)
ok('it needs the network named on the command line', /refuse\(`SOLANA_NETWORK is \$\{network\}/.test(script))
ok('it will not make a second collection', /refuse\('TBT_COLLECTION_ADDRESS is already set/.test(script))
ok('it needs the collection URI', /refuse\('--uri is required/.test(script))
ok('it goes through createTitleCollection', /await createTitleCollection\(uri\)/.test(script))
ok('registered in package.json', /"chain:create-collection"/.test(read('package.json')))

const doc = read('documentation/mainnet-switch.md')
const steps = ['11.1', '11.2', '11.3', '11.4', '11.5', '11.6', '11.7', '11.8']
for (let i = 0; i < steps.length; i++) ok(`the runbook has ${steps[i]}`, doc.includes(`## ${steps[i]}`))
ok('the runbook names what Federico brings first', /Fund the payer/.test(doc) && /Helius/.test(doc) && /second holder/.test(doc))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
