import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 10 — the eight prototype example IDs are reserved for ever.
 *
 * platform_config.tbt_id_reserved holds them and generate_tbt_id refuses every
 * one. The forcing test runs as a rolled-back dry-run against the database: with
 * setseed fixed, the generator's first draw is known; reserve that draw and the
 * same seed must return a different ID. This guard holds the code to the rule.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const PROTOTYPE = ['AUR4421', 'TWW8803', 'LAV2209', 'TOG1107', 'RRO5501', 'TYC3302', 'ELU7704', 'WLI9901']

const migs = readdirSync(join(root, 'supabase/migrations')).sort()
const name = migs.filter((f) => /_reserved_tbt_ids\.sql$/.test(f)).pop()
ok('a reserved_tbt_ids migration exists', !!name)
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('platform_config holds the reserved list', /add column if not exists tbt_id_reserved text\[\] not null default '\{\}'/.test(mig))
for (let i = 0; i < PROTOTYPE.length; i++) ok(`reserved · ${PROTOTYPE[i]}`, mig.includes(`'${PROTOTYPE[i]}'`))
ok('the generator reads the list', /select tbt_id_blocklist, tbt_id_reserved\s+into v_blocklist, v_reserved/.test(mig))
ok('a reserved candidate is never returned', /and not \(candidate = any \(v_reserved\)\)/.test(mig))
ok('the generator stays closed to clients', /revoke execute on function public\.generate_tbt_id\(uuid\) from public, anon, authenticated/.test(mig))

// The last migration that defines the generator is the one that runs.
let last = ''
for (let i = 0; i < migs.length; i++) if (/create or replace function public\.generate_tbt_id\(/.test(read(`supabase/migrations/${migs[i]}`))) last = migs[i]
ok('no later migration redefines it without the rule', last === name, `last definition: ${last}`)

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
