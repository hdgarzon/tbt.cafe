import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 3 (placed by Work Order 02 §14) — holder identity.
 *
 * A new code on every history row; unique within the work; never derived; no
 * record carries a name when holder_named is false; the website follows the
 * anonymous switch; "Current owner" is the holder.
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
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_holder_identity\.sql$/.test(f)).sort().pop()
  ok('a holder_identity migration exists', !!name)
  const mig = name ? code(`supabase/migrations/${name}`) : ''

  ok('ownership_history carries the code and the choice',
     /add column if not exists holder_code integer/.test(mig) && /add column if not exists holder_named boolean not null default false/.test(mig) && /add column if not exists holder_public_name text/.test(mig))
  ok('the code is five digits', /check \(holder_code between 10000 and 99999\)/.test(mig))
  ok('unique within the work', /unique \(work_id, holder_code\)/.test(mig))
  ok('a name only with the choice', /check \(not holder_named or holder_public_name is not null\)/.test(mig))
  ok('every insert gets a random code, never derived',
     /create trigger issue_holder_code\s+before insert on public\.ownership_history/.test(mig) && /10000 \+ floor\(random\(\) \* 90000\)/.test(mig))
  ok('a code the caller supplies is ignored', /new\.holder_code := /.test(mig))

  // ---- the records never carry an unnamed holder's name
  const xfer = code('src/app/api/complete-transfer/route.ts')
  ok('the transfer record names the holder only when chosen', /row\.holder_named && row\.holder_public_name/.test(read('src/lib/chain/provenance-publish.ts')) && !/to: \{ name: newOwnerName/.test(xfer))
  const lib = code('src/lib/holder.ts')
  ok('src/lib/holder.ts decides the label', /export function holderLabel/.test(lib) && /holder_named \? [\s\S]{0,60}holder_public_name/.test(lib))

  // ---- 3.4 the website follows the switch; 3.5 current owner
  const wd = code('src/lib/work-data.ts')
  ok('history rows read the holder code and the live switch', /holder_code/.test(wd) && /collector_anonymous/.test(wd))
  const info = code('src/components/work/InfoTab.tsx')
  ok('Current owner shows the holder, not the creator', !/currentOwner\} v=\{work\.creator/.test(info) && /currentHolder/.test(info))
  const langs = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    ok(`${langs[i]}: the private collector label`, typeof m.work?.privateCollector === 'string' && m.work.privateCollector.includes('{code}'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
