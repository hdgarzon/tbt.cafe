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

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
