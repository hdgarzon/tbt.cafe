import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 9 — the five receipts (D-6).
 *
 * Purchase, sale, transfer, royalty and registration, beside the payout
 * collection receipt that exists. Amounts come only from what was stored
 * (0.9c); neither the server route nor the page recomputes a fee.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const route = read('src/app/api/receipts/route.ts')
ok('the receipts route exists', route.length > 0)
ok('it never recomputes a fee', !/saleQuote\(|transferQuote\(|royaltyAmountOf\(|\* ?0\.029/.test(route))
const KINDS = ['purchase', 'sale', 'transfer', 'royalty', 'registration']
for (let i = 0; i < KINDS.length; i++) ok(`it builds the ${KINDS[i]} receipt`, new RegExp(`kind === '${KINDS[i]}'`).test(route))
ok('purchase: the name on the card statement', /'statement'/.test(route))
ok('sale: card processing on the full charge, and the net', /'processing'/.test(route) && /seller_net/.test(route))
ok('sale, direct path: paid to the Stripe account', /'paidToStripe'/.test(route))
ok('sale, platform path: the settlement date and any first-payout hold', /'settles'/.test(route) && /releases_at/.test(route))
ok('royalty: release date or available', /state === 'available'/.test(route))
ok('each receipt is for its own party only', /to_owner_id !== userId/.test(route) && /from_owner_id !== userId/.test(route) && /user_id !== userId/.test(route))

ok('a transfer stores its amounts when it is created',
   /buyer_total: quote\.total/.test(read('src/app/api/transfer/create/route.ts')) && /processing: quote\.processing/.test(read('src/app/api/transfer/create/route.ts')))

const sheet = read('src/components/ReceiptSheet.tsx')
ok('one sheet renders every receipt', /export function ReceiptSheet\(/.test(sheet) && /\/api\/receipts\?kind=/.test(sheet))
ok('the sheet formats, never computes', !/saleQuote|transferQuote|0\.029/.test(sheet))

const pages = ['purchased', 'sales', 'royalties', 'brews']
for (let i = 0; i < pages.length; i++) ok(`history/${pages[i]} opens its receipt`, /ReceiptSheet/.test(read(`src/app/history/${pages[i]}/page.tsx`)))

const langs = ['en', 'es', 'pt', 'fr']
const keys = ['purchase', 'sale', 'transfer', 'royalty', 'registration', 'serviceFee', 'processing', 'declared', 'paidToStripe', 'settles', 'statement']
for (let l = 0; l < langs.length; l++) {
  const m = JSON.parse(read(`src/i18n/messages/${langs[l]}.json`))
  const missing = keys.filter((k) => typeof m.receipt?.[k] !== 'string')
  ok(`${langs[l]}: the Set 4.9 labels`, missing.length === 0, missing.join(', '))
}
ok('en: the Set 4.9 wording', JSON.parse(read('src/i18n/messages/en.json')).receipt?.paidToStripe === 'Paid to your Stripe account')

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
