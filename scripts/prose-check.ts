import { readFileSync } from 'fs'
import { join } from 'path'
import { proseValues, PROSE_NAMES, fillDeep, fillProse } from '../src/lib/prose'
import { ROAST_ARTICLES } from '../src/lib/roast-content'
import { LEGAL_DOCS } from '../src/lib/legal-content'
import { emailCopyFor } from '../src/lib/email-templates'
import { testRules } from './rules-fixture'

/**
 * Work Order 02, Stage 1.4 — prose follows the values.
 *
 * Where public text states a number this order configures, it carries a
 * placeholder filled from platform_config. Checked with unusual figures: if
 * the rendered text shows them, they came from the row.
 *
 * The Roast's worked examples ("x" blocks) are rewritten whole in Stage 13.2
 * with the Stage 0 arithmetic; they are listed, not checked, until then.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const ODD = testRules({
  transfer_window_hours: 37, registration_fee: 11, service_fee_buyer: 12, service_fee_seller: 13, transfer_fee: 14,
  royalty_floor_pct: 17, royalty_floor_min: 71, biometric_threshold: 555, payout_platform_pct: 0.031,
  settlement_days_standard: 6, settlement_days_high: 16, settlement_high_threshold: 1111,
})
const V = proseValues(ODD)

ok('every placeholder has a value', PROSE_NAMES.every((n) => n in V) && Object.keys(V).length === PROSE_NAMES.length)

// ---- figures that must never be written by hand in prose
const RAW = /\$8\b|\b8(\.00)? USD\b|\b5% or\b|\$25\b|\b25 USD\b|\b500 USD\b|\$500\b|\b2\.3%|\b24 (hours|horas|heures)\b|\bseven days\b|\bfourteen days\b|\b8 \$/

// Roast: prose blocks only
const roastProse: string[] = []
const roastTables: string[] = []
for (let i = 0; i < ROAST_ARTICLES.length; i++) {
  const a = ROAST_ARTICLES[i]
  for (let j = 0; j < a.body.length; j++) {
    const b = a.body[j] as { kind: string; html?: string; title?: string }
    if (b.kind === 'p' && b.html) { if (RAW.test(b.html)) roastProse.push(`${a.id}: ${b.html.match(RAW)![0]}`) }
    if (b.kind === 'x') roastTables.push(`${a.id}: ${b.title}`)
  }
}
ok('Roast prose writes no configured figure by hand', roastProse.length === 0, roastProse.join(' | '))
console.log(`note ${roastTables.length} worked examples wait for Stage 13.2: ${roastTables.join(' | ')}`)

const legalRaw = JSON.stringify(LEGAL_DOCS).match(new RegExp(RAW.source, 'g')) ?? []
ok('the Terms write no configured figure by hand', legalRaw.length === 0, legalRaw.join(', '))

const langs = ['en', 'es', 'pt', 'fr']
for (let i = 0; i < langs.length; i++) {
  const s = read(`src/i18n/messages/${langs[i]}.json`)
  const m = s.match(new RegExp(RAW.source, 'g')) ?? []
  ok(`${langs[i]}: interface strings write no configured figure by hand`, m.length === 0, m.join(', '))
}
const emails = read('src/lib/email-templates.ts').match(new RegExp(RAW.source, 'g')) ?? []
ok('e-Mail templates write no configured figure by hand', emails.length === 0, emails.join(', '))

// ---- and the placeholders render from the row
const roast = JSON.stringify(fillDeep(ROAST_ARTICLES, V))
ok('the Roast renders the configured window', roast.includes('37 hours'))
ok('the Roast renders the configured fee', roast.includes('$11') || roast.includes('11 USD'))
ok('the Roast leaves no placeholder of ours unfilled', !PROSE_NAMES.some((n) => roast.includes(`{${n}}`)))
const legal = JSON.stringify(fillDeep(LEGAL_DOCS, V))
ok('the Terms render the configured window', legal.includes('37 hours'))
ok('the Terms render the configured settlement', legal.includes('6 days') && legal.includes('16 days') && legal.includes('1,111'))
ok('the Terms leave no placeholder of ours unfilled', !PROSE_NAMES.some((n) => legal.includes(`{${n}}`)))
for (let i = 0; i < langs.length; i++) {
  const c = emailCopyFor('transfers', langs[i] as 'en', { title: 'T', variant: 'lapsed', ...V })
  ok(`${langs[i]}: the lapsed e-Mail states the configured window`, !!c && c.body.includes('37'))
}
ok('fillProse leaves foreign braces alone', fillProse('{amount} in {hours} hours', V) === '{amount} in 37 hours')

// ---- the pages and the senders fill them
for (const page of ['src/app/roast/[article]/page.tsx', 'src/app/legal/[doc]/page.tsx']) {
  const src = read(page)
  ok(`${page} fills from the public rules`, /fillDeep\([\s\S]{0,80}proseValues\(await getPublicRules\(\)\)/.test(src))
  ok(`${page} regenerates within a minute`, /export const revalidate = 60\b/.test(src))
}
ok('notification e-Mails receive the values', /proseValues\(await getRules\(\)\)/.test(read('src/lib/send-notification-email.ts')))
ok('the transfer sheet fills {hours}', /authoriseNote\.replace\('\{hours\}'/.test(read('src/components/work/TransferPanel.tsx')))
ok('the accept page fills {hours}', /lapsedBody\.replace\('\{hours\}'/.test(read('src/app/transfer/accept/[transferId]/page.tsx')))
ok('the brews page fills {fee}', /brewsEmpty\.replace\('\{fee\}'/.test(read('src/app/history/brews/page.tsx')))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
