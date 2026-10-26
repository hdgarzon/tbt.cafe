import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 10.1 — the test-data deletion is written, rehearsed, and
 * cannot run by accident.
 *
 * Dry run by default (counts only). --rehearse runs every delete inside a
 * transaction that rolls back and prints the counts after it (all zero is the
 * pass). --execute commits, and only with both profile lists Federico confirmed,
 * every profile classified, and --backup-taken. What is kept stays kept.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const s = read('scripts/cleanup-test-data.ts')
ok('the script exists', s.length > 0)
ok('dry run is the default', /const mode: Mode = args\.includes\('--execute'\) \? 'execute' : args\.includes\('--rehearse'\) \? 'rehearse' : 'dry-run'/.test(s))
ok('a rehearsal rolls back', /mode === 'execute' \? 'commit;' : 'rollback;'/.test(s))
ok('execute needs both lists', /--kept/.test(s) && /--deleted/.test(s) && /refuse\('execute needs --kept and --deleted/.test(s))
ok('execute needs a backup', /refuse\('execute needs --backup-taken/.test(s))
ok('every profile is classified before anything runs', /refuse\(`unclassified profiles:/.test(s))
ok('the originality index goes entirely', /\['image_vectors', 'true'\]/.test(s))
ok('every work goes', /\['works', 'true'\]/.test(s))
ok('covered registrations reset to the full allowance', /\['covered_registrations', 'true'\]/.test(s))
ok('kept people get new codes', /update public\.profiles set creator_code = null where id = any/.test(s))
ok('the security record is kept', !/delete from public\.admin_audit_log/.test(s) && !/'admin_audit_log'/.test(s))
ok('platform_config and Roast are kept', !/\['platform_config'/.test(s) && !/\['roast/.test(s))
ok('works-media is emptied through the storage API', /storage\.from\('works-media'\)\.remove\(/.test(s))
ok('a table that does not exist yet is skipped, not guessed', /to_regclass/.test(s))
ok('the counts run again after execute', /after: every count should be zero/.test(s))
ok('registered in package.json', /"cleanup:test-data"/.test(read('package.json')))

// The CLI answers in JSON only when it thinks an agent is calling; a person at a
// terminal gets a text table. The rehearsal of 26 October read that table as no
// rows, called every table missing and counted 0 profiles out of 14.
ok('the query asks for JSON explicitly', /'--output-format', 'json'/.test(s))
ok('output it cannot read is an error, not an empty answer', /throw new Error\(`supabase db query: unreadable output/.test(read('scripts/query-output.ts')) && !/if \(start < 0\) return \[\]/.test(s))
ok('the script reads it through queryRows', /return queryRows\(out\)/.test(s))
// And the two JSON shapes it gives: a bare array to a person, an envelope with
// rows to an agent. A text table is neither.
{
  const { queryRows } = require('./query-output') as typeof import('./query-output')
  const bare = queryRows('Initialising login role...\n[\n  { "t": "works" },\n  { "t": "offers" }\n]\n')
  ok('a bare array is read', bare.length === 2 && bare[0].t === 'works')
  const env = queryRows('{ "boundary": "x", "rows": [ { "n": 3 } ], "warning": "untrusted" }')
  ok('an envelope with rows is read', env.length === 1 && env[0].n === 3)
  ok('an empty array is no rows, not an error', queryRows('[]').length === 0)
  let threw = false
  try { queryRows('┌───┐\n│ t │\n└───┘') } catch { threw = true }
  ok('a text table is an error', threw)
}
ok('it refuses to go on if it cannot see the works table', /if \(!present\.includes\('works'\)\) refuse\(/.test(s))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
