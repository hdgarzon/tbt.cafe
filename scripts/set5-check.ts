import { readFileSync } from 'fs'
import { join } from 'path'
import { ROAST_ARTICLES } from '../src/lib/roast-content'
import { saleQuote } from '../src/lib/fees'
import { testRules } from './rules-fixture'

/**
 * Work Order 02, Set 5.2 and 5.3 — Roast and the assistant say what the product
 * now does: selling needs approval, offers freeze the work and give a payment
 * window, a transfer's value is confirmed by the recipient, payouts go by USDC
 * or bank through Stripe Connect, and the phone number can be changed safely.
 * Figures that live in configuration are prose values, never typed by hand.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const article = (id: string) => JSON.stringify(ROAST_ARTICLES.find((a) => a.id === id) ?? {})

// ---- Selling (with Stage 0: the 12,000 example and the card statement)
const selling = article('selling')
ok('selling: approval and the Selling menu item', /needs approval/.test(selling) && /<b>Selling<\/b>/.test(selling))
ok('selling: whose name is on the card statement', /card statement/.test(selling))
ok('selling: the 12,000 example', /12,008\.00/.test(selling) && /348\.53/.test(selling) && /1,200\.00/.test(selling) && /10,443\.47/.test(selling))
ok('selling: the old 18,000 example is gone', !/18,000/.test(selling))
{
  // The example is the arithmetic the product does.
  const q = saleQuote({ price: 12000, royalty: { type: 'percentage', value: 10 }, path: 'direct' }, testRules())
  ok('the example matches fees.ts', q.buyerTotal === 12008 && q.processing === 348.53 && q.sellerNet === 10443.47, JSON.stringify(q))
}

// ---- Offers
const offers = article('offers')
ok('offers: duration up to {offer_max_hours}', /\{offer_max_hours\}/.test(offers))
ok('offers: what acceptance freezes', /frozen|freezes/.test(offers))
ok('offers: the payment window is a prose value', /\{offer_payment_hours\}/.test(offers) && !/24-hour|24 hours/.test(offers))
ok('offers: messages are private and can be reported', /private/.test(offers) && /report/i.test(offers))
ok('offers: when the owner cannot sell yet', /isn’t approved|not approved|approved to sell/.test(offers))
ok('the payment window is a prose value in prose.ts', /offer_payment_hours: String\(rules\.offers\.paymentWindowHours\)/.test(readFileSync(join(__dirname, '..', 'src/lib/prose.ts'), 'utf8')))

// ---- Transfers
const transfers = article('transfers')
ok('transfers: {hours} hours', /\{hours\} hours/.test(transfers))
ok('transfers: the recipient confirms the declared value', /confirms the declared value|confirm the declared value/.test(transfers))
ok('transfers: sales made elsewhere, closing like transfer.elsewhere', /any royalty is calculated on it/.test(transfers))

// ---- Payouts
const payouts = article('payouts')
ok('payouts: USDC and bank through Stripe Connect', /USDC/.test(payouts) && /bank/.test(payouts) && /Stripe Connect/.test(payouts))
ok('payouts: PayPal, USDT and BTC are gone', !/PayPal|USDT|BTC/.test(payouts))
ok('payouts: the method is chosen at each collection', /each time you collect|at each collection/.test(payouts))
ok('payouts: earnings kept where payouts do not reach', /kept/.test(payouts))
ok('payouts: institutions by request', /institution/i.test(payouts))

// ---- Staying safe
const safe = article('staying-safe')
ok('safe: changing your phone number', /change your phone number|Changing your phone number/i.test(safe))
ok('safe: the alarm to the old number', /old number/.test(safe))
ok('safe: private-code reset by help request', /help request/.test(safe) && /private code/.test(safe))

// ---- Assistant (5.3), in all four languages
const k = readFileSync(join(__dirname, '..', 'src/lib/assistant/knowledge.ts'), 'utf8')
ok('assistant: an offers entry', /id: 'offers'/.test(k))
ok('assistant: selling needs approval', /needs approval/.test(k))
{
  // The example is computed by saleQuote inside the assistant, in four languages.
  const { knowledgeFor } = require('../src/lib/assistant/knowledge') as typeof import('../src/lib/assistant/knowledge')
  const sale = knowledgeFor(testRules()).find((d) => d.id === 'sale_fees')
  const bodies = sale ? [sale.body.en, sale.body.es, sale.body.pt, sale.body.fr] : []
  ok('assistant: the 12,000 example in four languages', bodies.length === 4 && /10,443\.47/.test(bodies[0]) && /10\.443,47/.test(bodies[1]) && /10\.443,47/.test(bodies[2]) && /10 443,47/.test(bodies[3]), bodies.join(' | ').slice(0, 300))
}
ok('assistant: transfers confirm the declared value and cover sales elsewhere', /confirms the declared value/.test(k) && /sold elsewhere|made elsewhere/.test(k))
ok('assistant: payouts by USDC or bank', /USDC/.test(k) && !/PayPal/.test(k))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
