import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, 7.3 — the recovery sweep.
 *
 * Idempotent, and never republishing anything whose Arweave ID is stored:
 *  a  certified work with no registration record → publish it (image first);
 *  b  registration record but no token → mint against the stored record;
 *  c  history row with no token move → move the token;
 *  d  history row with a move but no provenance record → publish it;
 *  e  confirmed anchor with no proof record → publish it;
 *  f  anything failing for 24 hours → an operator ticket naming the work and the step.
 *
 * Built and callable, but not scheduled: the hourly schedule waits on
 * question (s). It must not appear in vercel.json or in a pg_cron job yet.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_chain_recovery\.sql$/.test(f)).sort().pop()
ok('a chain_recovery migration exists', !!name)
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('failures are tracked per work and step', /create table if not exists public\.chain_recovery_failures/.test(mig) && /unique \(work_id, step, subject_id\)/.test(mig))
ok('only the service role sees them', /enable row level security/.test(mig) && /revoke all on public\.chain_recovery_failures from anon, authenticated/.test(mig))

const sweep = read('src/lib/chain/recovery.ts')
ok('a/b: sealing goes through the one seal', /await sealOnChain\(admin, w\.id\)/.test(sweep))
ok('a: only works that can carry a record', /\.not\('content_hash', 'is', null\)/.test(sweep))
ok('b: certified works without a token', /\.is\('mint_address', null\)/.test(sweep))
ok('c: a missing move is retried', /await moveTokenForOwnership\(admin, \{/.test(sweep) && /token_move_signature/.test(sweep))
ok('d: a missing provenance record is published', /await publishProvenance\(admin, row\.id\)/.test(sweep))
ok('d: in sequence order, so each link has its prior', /\.order\('sequence_number', \{ ascending: true \}\)/.test(sweep))
ok('e: proofs', /await publishProofs\(admin\)/.test(sweep))
ok('f: a ticket after 24 hours', /FAILURE_TICKET_MS = 24 \* 3_600_000/.test(sweep) && /category: 'registration'/.test(sweep))
ok('f: one ticket per failure', /\.is\('ticket_ref', null\)/.test(sweep))
ok('a success clears the failure', /\.from\('chain_recovery_failures'\)\s*\.delete\(\)/.test(sweep))

const route = read('src/app/api/cron/chain-recovery/route.ts')
ok('the route runs the sweep', /await runChainRecovery\(/.test(route))
ok('the route is behind CRON_SECRET', /Bearer \$\{secret\}/.test(route) && /if \(!secret/.test(route))

ok('not scheduled on Vercel (question s)', !/chain-recovery/.test(read('vercel.json')))
const migs = readdirSync(join(root, 'supabase/migrations'))
let scheduled = false
for (let i = 0; i < migs.length; i++) if (/cron\.schedule[\s\S]{0,400}chain-recovery/.test(read(`supabase/migrations/${migs[i]}`))) scheduled = true
ok('not scheduled on Supabase (question s)', !scheduled)

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
