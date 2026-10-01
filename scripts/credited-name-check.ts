import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 1.3 — the credited name is confirmed at the first brew.
 *
 * The name a work is credited under goes on a permanent record. Before the
 * first Seal the creator sees it with the note and confirms it (or enters an
 * alias); the Seal waits until then; later brews use it without asking.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_credited_name\.sql$/.test(f)).sort().pop()
ok('a credited_name migration exists', !!name)
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('profiles records the confirmation', /add column if not exists credited_name_confirmed_at timestamptz/.test(mig))

const route = read('src/app/api/brew/credited-name/route.ts')
ok('the route confirms with the service role', /createAdminClient\(\)/.test(route) && /credited_name_confirmed_at: /.test(route) && /public_alias: /.test(route))

const wiz = read('src/components/brew/BrewWizard.tsx')
ok('the seal waits for the confirmation', /function startSeal\(\) \{\s*if \(needsCreditedName\) return/.test(wiz))
ok('Brew shows the name with the note', /t\.brew\.creditedNameNote/.test(wiz))
ok('a confirmed name is not asked again', /credited_name_confirmed_at/.test(wiz) || /credited_name_confirmed_at/.test(read('src/lib/brew-data.ts')))

const langs = ['en', 'es', 'pt', 'fr']
for (let i = 0; i < langs.length; i++) {
  const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
  ok(`${langs[i]}: the note`, typeof m.brew?.creditedNameNote === 'string' && typeof m.brew?.creditedNameLabel === 'string')
}
ok('en: the note is the Chains 01 wording', JSON.parse(read('src/i18n/messages/en.json')).brew.creditedNameNote === 'This name goes on the permanent record of every work you register. It cannot be removed later.')

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
