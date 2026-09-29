import { LEGAL_DOCS, LEGAL_ENTITY } from '../src/lib/legal-content'

/**
 * Terms and Privacy — interim correction 01 (28 September 2026).
 *
 * Stripe reviews tbt.cafe for Connect and USDC payouts and may read these
 * pages. Before this correction they described a TBT as a token the buyer
 * acquires, said tbt.cafe holds blockchain keys, named the operator as a
 * d/b/a, left governing law unfilled, and both carried the "Working draft"
 * banner. This guard holds the checks Federico listed before deploy.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const text = (slug: string) => {
  const doc = LEGAL_DOCS.find((d) => d.slug === slug)
  if (!doc) return ''
  return doc.body
    .map((b: any) => [b.text, b.html, ...(b.items ?? [])].filter(Boolean).join('\n'))
    .join('\n')
}
const all = LEGAL_DOCS.map((d) => text(d.slug)).join('\n')
const terms = text('terms')
const privacy = text('privacy')

ok('the legal name is exact', LEGAL_ENTITY === '88 Greenwich Ave LLC')
ok('no "d/b/a" anywhere', !/d\/b\/a/i.test(all + LEGAL_ENTITY))
ok('no "token and everything it holds"', !all.includes('token and everything it holds'))
ok('no "nothing more"', !all.includes('nothing more'))
ok('no "to be confirmed by counsel"', !all.includes('to be confirmed by counsel'))
ok('no keys held for users', !all.includes('We generate and hold the blockchain keys'))
ok('no "block or reverse a registration"', !all.includes('block or reverse a registration'))

ok('Terms are out of draft', LEGAL_DOCS.find((d) => d.slug === 'terms')?.draft === false)
ok('Privacy is out of draft', LEGAL_DOCS.find((d) => d.slug === 'privacy')?.draft === false)

// Section 1 of the Terms correction, and the four Set 5 clauses true today.
const CLAUSES: [string, string][] = [
  ['What a TBT is and what you buy', 'When you buy through tbt.cafe, you buy the work.'],
  ['The records on the chains', 'tbt.cafe does not hold cryptocurrency for you.'],
  ['Governing law', 'governed by the laws of the State of Delaware'],
  ['Scope of service', 'It does not ship, inspect, appraise or warrant any physical work.'],
  ['Sales arranged elsewhere', 'tbt.cafe is not a party to a sale arranged elsewhere'],
  ['Refunds and disputes', 'Ownership is never reversed'],
  ['Royalty lock', 'including a gift at zero value'],
]
for (const [name, phrase] of CLAUSES) ok(`Terms carry "${name}"`, terms.includes(phrase))

// The five Set 5 clauses that ship with Work Order 02 stay out.
const LATER = ['on their own payment account', 'Selling a work requires approval', 'Messages sent with offers are private', 'must be accepted within {hours}', 'become available after {standard}']
for (const phrase of LATER) ok(`not yet: "${phrase}"`, !terms.includes(phrase))

// Privacy: the list follows the code. SMS runs on Twilio only (A2 removed SNS);
// the originality check runs on Fly.io.
ok('Privacy names the USDC wallet for payouts', privacy.includes('USDC wallet address you choose for payouts'))
ok('Stripe line names USDC payouts', privacy.includes('including payouts in USDC to the wallet address you choose'))
ok('Fly.io runs the originality check', privacy.includes('<b>Fly.io</b> — to run the originality check on registered images.'))
ok('no Amazon Web Services', !privacy.includes('Amazon Web Services'))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
