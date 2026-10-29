import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01 — the three chain jobs run every hour, on Supabase Cron.
 *
 * Question (s) asked whether they belong inside Work Order 02's 15-minute sweep
 * or apart. Federico's answer (2 October): apart, hourly, through pg_net, the
 * same way as tbt-sweep, with the daily Vercel upgrade kept as a fallback.
 *
 *  - tbt-anchor-upgrade  → /api/cron/anchor-upgrade   (6.2)
 *  - tbt-chain-recovery  → /api/cron/chain-recovery   (7.3)
 *  - tbt-balance-alarm   → /api/cron/balance          (7.2.2)
 *
 * The address and the secret come from Vault at run time, never from the text.
 * The readiness check reads the schedule through one function that only the
 * service role may call.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')

const JOBS: [string, string][] = [
  ['tbt-anchor-upgrade', '/api/cron/anchor-upgrade'],
  ['tbt-chain-recovery', '/api/cron/chain-recovery'],
  ['tbt-balance-alarm', '/api/cron/balance'],
]

const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_chain_jobs\.sql$/.test(f)).sort().pop()
ok('a chain_jobs migration exists', !!name)
const mig = code(name ? read(`supabase/migrations/${name}`) : '')

ok('pg_cron and pg_net', /create extension if not exists pg_cron/.test(mig) && /create extension if not exists pg_net/.test(mig))

for (let i = 0; i < JOBS.length; i++) {
  const [job, path] = JOBS[i]
  const at = mig.indexOf(`'${job}'`)
  const body = at === -1 ? '' : mig.slice(at, mig.indexOf('$job$);', at))
  ok(`${job} is scheduled`, new RegExp(`cron\\.schedule\\(\\s*'${job}'`).test(mig))
  ok(`${job} runs once an hour`, /^'[^']+',\s*'([0-5]?\d) \* \* \* \*'/.test(body), body.slice(0, 60))
  ok(`${job} calls ${path} with GET`, body.indexOf('net.http_get(') !== -1 && body.indexOf(`'${path}'`) !== -1)
  ok(`${job} reads the address and the secret from Vault`,
     /name = 'app_url'/.test(body) && /name = 'cron_secret'/.test(body) && /'Bearer ' \|\|/.test(body))
}
ok('no secret is written in the text', !/Bearer [A-Za-z0-9_-]{8,}/.test(mig))

// Staggered: the upgrade confirms first, the sweep then publishes those proofs
// (7.3 e), and the alarm reads what the sweep spent.
const minute = (job: string) => Number((mig.match(new RegExp(`'${job}',\\s*'(\\d+) \\* \\* \\* \\*'`)) ?? [])[1])
ok('upgrade, then sweep, then alarm',
   minute('tbt-anchor-upgrade') < minute('tbt-chain-recovery') && minute('tbt-chain-recovery') < minute('tbt-balance-alarm'))

// The readiness check reads the schedule, and nobody else can.
ok('a function reports the schedule', /create or replace function public\.chain_jobs_scheduled\(\)/.test(mig))
ok('it runs as definer with an empty search path', /security definer\s+set search_path = ''/.test(mig))
ok('it is revoked from the browser roles',
   /revoke execute on function public\.chain_jobs_scheduled\(\) from public, anon, authenticated/.test(mig))
ok('only the service role calls it', /grant execute on function public\.chain_jobs_scheduled\(\) to service_role/.test(mig))

// The routes stay behind the secret; the daily Vercel upgrade stays as a fallback.
const recovery = read('src/app/api/cron/chain-recovery/route.ts')
const balance = read('src/app/api/cron/balance/route.ts')
ok('the sweep refuses without CRON_SECRET', /if \(!secret \|\| request\.headers\.get\('authorization'\) !== `Bearer \$\{secret\}`\)/.test(recovery))
ok('the alarm refuses without CRON_SECRET', /if \(!secret \|\| request\.headers\.get\('authorization'\) !== `Bearer \$\{secret\}`\)/.test(balance))
const vercel = JSON.parse(read('vercel.json') || '{}')
const crons: { path?: string; schedule?: string }[] = vercel.crons ?? []
ok('the daily Vercel upgrade stays as a fallback',
   crons.some((c) => c.path === '/api/cron/anchor-upgrade' && /^\d+ \d+ \* \* \*$/.test(c.schedule ?? '')))
ok('nothing on Vercel runs more than daily (Hobby)', crons.every((c) => /^\d+ \d+ \* \* \*$/.test(c.schedule ?? '')))
ok('the sweep and the alarm are not on Vercel', !crons.some((c) => c.path === '/api/cron/chain-recovery' || c.path === '/api/cron/balance'))

ok('registered in package.json', /"check:chainjobs"/.test(read('package.json')))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
