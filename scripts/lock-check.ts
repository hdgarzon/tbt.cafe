import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 3 — the commerce write path and the royalty lock.
 *
 * Every ownership-changing path locks the royalty in its transaction; a
 * locked royalty cannot be updated; no client policy writes work_commerce;
 * the ceiling is 90.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

async function main() {
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_commerce_lock\.sql$/.test(f))[0]
  ok('a commerce_lock migration exists', !!name)
  const mig = name ? code(`supabase/migrations/${name}`) : ''

  // ---- 3.2 clients never write commerce
  ok('the creator write policy is dropped', /drop policy if exists "Creadores pueden gestionar commerce" on public\.work_commerce/.test(mig))
  ok('client roles cannot write it', /revoke insert, update, delete on public\.work_commerce from anon, authenticated/.test(mig))
  ok('no new client write policy', !/create policy [^\n]+ on public\.work_commerce\s+for (insert|update|delete|all)/.test(mig))

  // ---- 3.3 the lock
  ok('lock_royalty exists and records when and by what',
     /create or replace function public\.lock_royalty\(p_work_id uuid, p_event uuid\)/.test(mig) &&
     /royalty_locked = true/.test(mig) && /royalty_locked_at = coalesce\(royalty_locked_at, now\(\)\)/.test(mig) && /royalty_locked_by = coalesce\(royalty_locked_by, p_event\)/.test(mig))
  ok('nobody but the database calls it', /revoke execute on function public\.lock_royalty\(uuid, uuid\) from public, anon, authenticated/.test(mig))
  ok('every change of ownership locks it, in the same transaction',
     /create trigger ownership_locks_royalty\s+after insert on public\.ownership_history\s+for each row\s+when \(new\.sequence_number > 1\)/.test(mig))
  ok('a locked royalty refuses any update',
     /create trigger work_commerce_royalty_locked\s+before update on public\.work_commerce/.test(mig) &&
     /old\.royalty_locked and \(new\.royalty_type is distinct from old\.royalty_type or new\.royalty_value is distinct from old\.royalty_value or not new\.royalty_locked\)/.test(mig))

  // ---- 3.4 ceiling, 3.6 freeze
  ok('the percentage ceiling is 90', /royalty_value >= \(?0\)?(::numeric)? and royalty_value <= \(?90\)?/.test(mig))
  ok('the freeze column exists', /add column if not exists frozen_offer_id uuid/.test(mig))

  // ---- 3.1 the route
  const route = code('src/app/api/work/commerce/route.ts')
  ok('the route exists', route.length > 0)
  ok('only the current holder writes', /current_owner_id !== auth\.user\.id/.test(route))
  ok('the route writes with the service role', /createAdminClient\(\)/.test(route))
  const plan = code('src/lib/commerce.ts')
  ok('for sale needs an active seller and no global pause', /canSell\(/.test(plan) && /pauses\.selling\.on/.test(plan))
  ok('a frozen work refuses every change', /frozen_offer_id[\s\S]{0,80}'frozen'/.test(plan))
  ok('a locked royalty refuses a change', /royalty_locked[\s\S]{0,120}'royalty_locked'/.test(plan))
  ok('a percentage above the ceiling is refused', /pctCeiling[\s\S]{0,80}'above_ceiling'/.test(plan))
  ok('a fixed royalty lifts the price to the floor', /minPriceFor\([\s\S]{0,200}priceLifted/.test(plan))

  // ---- no client writes commerce any more
  const wd = code('src/lib/work-data.ts')
  ok('work-data writes commerce through the route', !/from\('work_commerce'\)\.update\(/.test(wd) && /\/api\/work\/commerce/.test(wd))
  ok('registration writes commerce with the service role', /createAdminClient\(\)[\s\S]{0,60}\.from\('work_commerce'\)[\s\S]{0,20}\.upsert\(/.test(code('src/app/api/complete-tbt/route.ts')))

  // ---- the screen reads the lock and the rules
  const tab = code('src/components/work/ActionTab.tsx')
  ok('ActionTab reads royalty_locked and stops deriving it from sales', /const royaltyLocked = c\.royalty_locked\b/.test(tab) && !/royalty_locked \|\| hasSold/.test(tab))
  ok('the royalty control reaches the configured ceiling', /rules\.royalty\.pctCeiling/.test(tab) && !/n > 50\b/.test(tab))
  ok('the warning above the configured mark', /royalty\.warnHigh/.test(tab) && /rules\.royalty\.pctWarning/.test(tab))
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
