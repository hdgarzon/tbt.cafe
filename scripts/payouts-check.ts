import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 7 — payouts.
 *
 * No default destination exists; collection requires an explicit method; a
 * payee is never offered a rail provider_countries does not allow; an
 * institution's collection opens a ticket; fees come from configuration.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

function walk(dir: string, out: string[]): string[] {
  const e = readdirSync(dir, { withFileTypes: true })
  for (let i = 0; i < e.length; i++) {
    const p = join(dir, e[i].name)
    if (e[i].isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

async function main() {
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_payout_methods\.sql$/.test(f)).sort().pop()
  ok('a payout_methods migration exists', !!name)
  const mig = name ? code(`supabase/migrations/${name}`) : ''

  // ---- 7.1 no default destination
  ok('is_default is dropped', /drop column if exists is_default/.test(mig) && /drop index if exists (public\.)?payout_destinations_default_idx/.test(mig))
  ok('one destination per method', /unique \(user_id, method_id\)/.test(mig))
  const files = walk(join(root, 'src'), [])
  const defaults = files.filter((f) => /\bis_default\b/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
  ok('no code reads or writes a default destination', defaults.length === 0, defaults.map((f) => f.slice(root.length + 1)).join(', '))

  // ---- 7.3 fees from configuration
  ok('the block takes the commission from configuration', /c\.payout_platform_pct/.test(mig))
  ok('and the method cost', /c\.payout_cost_bank/.test(mig) && /c\.payout_cost_usdc/.test(mig))
  ok('the earnings can be reserved for an institution', /'reserved'/.test(mig))

  // ---- 7.2 rails by country
  const rails = code('src/lib/payout-rails.ts')
  ok('src/lib/payout-rails.ts decides the rails', /export function railsFor/.test(rails))
  ok('bank only where the country has it', /payout_bank/.test(rails))
  ok('USDC only where listed, while enabled, and for individuals or sole proprietors',
     /payout_usdc && rules\.payouts\.usdcEnabled/.test(rails) && /'company'[\s\S]{0,60}'institution'/.test(rails))

  // ---- the collect route
  const collect = code('src/app/api/payouts/collect/route.ts')
  ok('collection requires an explicit method', /'method_required'/.test(collect))
  ok('a method outside the rails is refused', /railsFor\(/.test(collect) && /'rail_not_allowed'/.test(collect))
  ok('no rail disables collection', /'not_covered'/.test(collect))
  ok('an institution opens a payouts ticket and reserves the earnings', /institution[\s\S]{0,600}category: 'payouts'/.test(collect) && /state: 'reserved'/.test(collect))

  // ---- the screens
  const sheet = code('src/components/CollectSheet.tsx')
  ok('the collect sheet preselects no method', /useState<PayoutMethod \| null>\(null\)/.test(sheet) && !/setActiveMethod\(list\[0\]/.test(sheet))
  ok('it asks which method this time', /t\.payouts\.chooseMethod/.test(sheet))
  ok('it says when no rail reaches', /t\.payouts\.notCovered/.test(sheet))
  ok('the menu says Payout Methods', /t\.menu\.payoutMethods/.test(code('src/components/SlideMenu.tsx')))

  const langs = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    ok(`${langs[i]}: Set 4.5 strings`, typeof m.menu?.payoutMethods === 'string' && ['chooseMethod', 'recovered', 'institution', 'notCovered'].every((k) => typeof m.payouts?.[k] === 'string'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
