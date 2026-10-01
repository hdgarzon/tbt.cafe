import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 11 — pause switches.
 *
 * Every route that registers, lists, offers, transfers, charges or collects
 * calls assertNotPaused; each switch has its message in four languages; a
 * banner shows every active switch.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const code = (p: string) =>
  existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') : ''

const rules = code('src/lib/rules.ts')
ok('rules.ts exports assertNotPaused', /export async function assertNotPaused\(key: PauseKey\)/.test(rules))

const ROUTES: Array<[string, string]> = [
  ['src/app/api/stripe/create-checkout/route.ts', 'registration'],
  ['src/app/api/complete-tbt/route.ts', 'registration'],
  ['src/app/api/work/commerce/route.ts', 'selling'],
  ['src/app/api/stripe/create-purchase/route.ts', 'selling'],
  ['src/app/api/offers/route.ts', 'offers'],
  ['src/app/api/offers/[id]/route.ts', 'offers'],
  ['src/app/api/transfer/create/route.ts', 'transfers'],
  ['src/app/api/payouts/collect/route.ts', 'payouts'],
]
for (let i = 0; i < ROUTES.length; i++) {
  const [file, key] = ROUTES[i]
  ok(`${file} checks the ${key} switch`, code(file).includes(`assertNotPaused('${key}')`))
}
ok('pending transfers can still be accepted', !code('src/app/api/transfer/respond/route.ts').includes("assertNotPaused('transfers')"))
ok('with offers paused, the sweep lapses live offers', /pauses\.offers\.on[\s\S]{0,400}'offers_paused'/.test(code('src/lib/offer-sweep.ts')))

const banner = code('src/components/PauseBanner.tsx')
ok('a banner shows every active switch in the reader’s language', /pauses/.test(banner) && /message\[lang\]/.test(banner) && /useLocale\(\)/.test(banner))
ok('the shell mounts it', /<PauseBanner \/>/.test(code('src/components/AppShell.tsx')))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
