import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 2 — the seller state.
 *
 * No path sets availability to for sale without an active, unsuspended seller
 * state; seller_accounts cannot be deleted; paused_self and suspension are
 * independent; the path comes only from provider_countries.
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
  const migName = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_seller_accounts\.sql$/.test(f))[0]
  ok('a seller_accounts migration exists', !!migName)
  const mig = migName ? code(`supabase/migrations/${migName}`) : ''

  // ---- 2.1 the table
  ok('status is one of the five states',
     /status text not null default 'not_applied'\s+check \(status in \('not_applied', 'pending', 'declined', 'active', 'paused_self'\)\)/.test(mig))
  ok('suspension lives in its own columns', /suspended_at timestamptz/.test(mig) && /suspended_reason text/.test(mig) && /suspended_by uuid/.test(mig))
  ok('charge path is direct or platform', /charge_path text check \(charge_path in \('direct', 'platform'\)\)/.test(mig))
  ok('entity type is one of four', /entity_type text check \(entity_type in \('individual', 'sole_proprietor', 'company', 'institution'\)\)/.test(mig))
  ok('the person cannot be deleted from under it', /user_id uuid primary key references auth\.users\(id\) on delete restrict/.test(mig))
  ok('remembered listings are stored', /remembered_listings uuid\[\] not null default '\{\}'/.test(mig))
  ok('RLS is on', /alter table public\.seller_accounts enable row level security/.test(mig))
  ok('a person reads only their own row', /create policy "[^"]+" on public\.seller_accounts\s+for select using \(user_id = \(select auth\.uid\(\)\)\)/.test(mig))
  ok('no client policy writes or deletes it', !/on public\.seller_accounts\s+for (insert|update|delete|all)/.test(mig))
  ok('deletion is revoked outright', /revoke insert, update, delete on public\.seller_accounts from anon, authenticated/.test(mig))

  // ---- 2.2 provider_countries
  ok('provider_countries has the rails', /create table if not exists public\.provider_countries[\s\S]{0,400}merchant boolean[\s\S]{0,200}payout_bank boolean[\s\S]{0,200}payout_usdc boolean[\s\S]{0,200}enabled boolean/.test(mig))
  ok('the seed cites Stripe', /docs\.stripe\.com/.test(read(`supabase/migrations/${migName ?? 'x'}`)))
  ok('the seed is not empty', /insert into public\.provider_countries/.test(mig))

  // ---- the database refuses a sale without an active seller
  ok('a trigger guards for_sale', /create trigger [a-z_]+\s+before insert or update of availability on public\.work_commerce/.test(mig))
  ok('it requires active and not suspended',
     /s\.status = 'active'[\s\S]{0,80}s\.suspended_at is null/.test(mig))

  // ---- 2.3 the rule, in one place
  const lib = code('src/lib/seller.ts')
  ok('src/lib/seller.ts exists', lib.length > 0)
  ok('the path is direct only where merchant', /merchant \? 'direct' : 'platform'/.test(lib))
  ok('covered only with a payout rail', /payout_bank \|\| \(row\.payout_usdc && rules\.payouts\.usdcEnabled\)/.test(lib))
  ok('selling means active and not suspended', /status === 'active' && !seller\.suspended_at/.test(lib))

  // ---- the routes
  const sell = code('src/app/api/selling/route.ts')
  ok('the application is refused where no rail reaches', /coverageFor\([\s\S]{0,300}not_covered/.test(sell))
  ok('the application asks agreement to the selling terms', /agree !== true[\s\S]{0,80}terms_required/.test(sell))
  ok('a suspended seller cannot resume', /suspended_at[\s\S]{0,120}suspended/.test(sell) && /action === 'resume'/.test(sell))
  ok('pausing remembers the listed works', /remembered_listings/.test(sell) && /action === 'pause'/.test(sell))

  const adm = code('src/app/api/admin/sellers/route.ts')
  const actions = ['seller.approve', 'seller.decline', 'seller.suspend', 'seller.reinstate']
  for (let i = 0; i < actions.length; i++) {
    ok(`${actions[i]} goes through two people`, adm.includes(`'${actions[i]}'`) && /gateHighRisk\(/.test(adm))
  }
  ok('approval reads the path from provider_countries', /from\('provider_countries'\)/.test(adm) && /pathFor\(/.test(adm))
  ok('every seller action requires a reason', /reason_required/.test(adm))
  ok('approval tells the applicant', /eventKey: 'selling_status'/.test(adm))
  const guard = code('src/lib/admin/guard.ts')
  ok('the four actions are high risk', actions.every((a) => guard.includes(`'${a}'`)))
  const page = code('src/app/admin/page.tsx')
  ok('each has an APPLY entry', actions.every((a) => page.includes(`'${a}': (a) =>`)))

  // ---- 2.4 the screen
  ok('Settings → Selling exists', read('src/app/settings/selling/page.tsx').length > 0)
  const langs = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    ok(`${langs[i]}: Set 4.1 selling strings`, !!m.selling && ['intro', 'apply', 'pending', 'declined', 'setup', 'activeDirect', 'activePlatform', 'notCovered', 'pause', 'paused', 'resume', 'restoreTitle', 'suspended', 'suspendedHelp'].every((k) => typeof m.selling[k] === 'string'))
    ok(`${langs[i]}: menu.selling`, typeof m.menu?.selling === 'string')
  }
  ok('selling_status is transactional', /selling_status: 'transactional'/.test(code('src/lib/notify.ts')))
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
