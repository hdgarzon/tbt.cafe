import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { thresholdsFor, levelFor, nextAlert } from '../src/lib/chain/balance-rules'
import { assertPayerCanMint, MIN_LAMPORTS_FOR_MINT } from '../src/lib/solana/keys'

/**
 * Chains 01, 7.2 — the payer's balance alarm.
 *
 * Warning at about 14 days of registrations at the trailing daily average,
 * never below 0.5 SOL; urgent at about 3 days, never below 0.2 SOL. Each alert
 * fires once per crossing, to operators by SMS and email, and leaves a provider
 * event. A mint is not attempted below the one-mint minimum, and that fires the
 * urgent alert. Built, not scheduled: the hourly schedule waits on question (s).
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'did not throw') } catch { ok(label, true) }
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const SOL = 1_000_000_000
const rules = { warningDays: 14, urgentDays: 3, warningFloorSol: 0.5, urgentFloorSol: 0.2 }

// ---- thresholds
{
  const quiet = thresholdsFor(0.1, rules)
  ok('a quiet week: the floors hold', quiet.warning === 0.5 * SOL && quiet.urgent === 0.2 * SOL)
  const busy = thresholdsFor(20, rules)
  ok('a busy week: days of registrations', busy.warning === 14 * 20 * MIN_LAMPORTS_FOR_MINT && busy.urgent === 3 * 20 * MIN_LAMPORTS_FOR_MINT)
  ok('urgent is below warning', busy.urgent < busy.warning && quiet.urgent < quiet.warning)
}

// ---- levels
{
  const t = thresholdsFor(0.1, rules)
  ok('1 SOL is fine', levelFor(1 * SOL, t) === 'ok')
  ok('0.4 SOL is a warning', levelFor(0.4 * SOL, t) === 'warning')
  ok('0.1 SOL is urgent', levelFor(0.1 * SOL, t) === 'urgent')
}

// ---- once per crossing: a simulated balance, hour by hour
{
  const t = thresholdsFor(0.1, rules)
  const hours = [1.2, 0.45, 0.44, 0.43, 0.15, 0.14, 0.3, 0.9, 0.4].map((s) => s * SOL)
  let open: 'warning' | 'urgent' | null = null
  const fired: string[] = []
  for (let i = 0; i < hours.length; i++) {
    const step = nextAlert(levelFor(hours[i], t), open)
    if (step.fire) fired.push(step.fire)
    open = step.open
  }
  ok('warning fires once, urgent fires once, a recovery then a new crossing fires again',
     fired.join(',') === 'warning,urgent,warning', fired.join(','))
}

// ---- 7.2.3: no mint below the minimum
throws('a mint is not attempted below the one-mint minimum', () => assertPayerCanMint(MIN_LAMPORTS_FOR_MINT - 1))
{
  let threw = false
  try { assertPayerCanMint(MIN_LAMPORTS_FOR_MINT) } catch { threw = true }
  ok('at the minimum it proceeds', !threw)
}

// ---- wiring
const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_balance_alarm\.sql$/.test(f)).sort().pop()
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('a balance_alarm migration exists', !!name)
ok('thresholds live in platform_config', /balance_warning_days/.test(mig) && /balance_urgent_days/.test(mig) && /balance_warning_floor_sol numeric not null default 0\.5/.test(mig) && /balance_urgent_floor_sol numeric not null default 0\.2/.test(mig))
ok('alerts are kept so each fires once', /create table if not exists public\.balance_alerts/.test(mig))
ok('operators edit the thresholds', /balance_warning_days: 'operator'/.test(read('src/lib/rules-shape.ts')))

const lib = read('src/lib/chain/balance.ts')
ok('it alerts by SMS and email', /sendSms\(/.test(lib) && /emails\.send\(/.test(lib))
ok('it records a provider event', /recordProviderEvent\(/.test(lib))
ok('only active operators are told', /\.eq\('active', true\)/.test(lib))
ok('a low balance at mint fires the urgent alert', /payer_balance_low/.test(read('src/lib/chain/seal.ts')) && /raiseUrgent\(/.test(read('src/lib/chain/seal.ts')))

const route = read('src/app/api/cron/balance/route.ts')
ok('the route needs CRON_SECRET', /if \(!secret \|\| request\.headers\.get\('authorization'\) !== `Bearer \$\{secret\}`\)/.test(route))
ok('not scheduled on Vercel (question s)', !/cron\/balance/.test(read('vercel.json')))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
