import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 0 — check:money.
 *
 * Every checkout charges exactly what its quote displays; the application fee
 * follows 0.1b; no route computes a fee outside fees.ts; a sale completes only
 * in completeSale and only from a webhook; a replayed event changes nothing;
 * every money row carries the four tax columns.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
const walk = (dir: string, out: string[] = []): string[] => {
  const names = readdirSync(join(root, dir))
  for (let i = 0; i < names.length; i++) {
    const rel = `${dir}/${names[i]}`
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out)
    else if (/\.tsx?$/.test(rel)) out.push(rel)
  }
  return out
}

// ---- the charge is the quote
const purchase = code(read('src/app/api/stripe/create-purchase/route.ts'))
ok('create-purchase quotes with saleQuote', /saleQuote\(\{/.test(purchase))
ok('the work line is the quoted price', /unit_amount: cents\(q\.price\)/.test(purchase))
ok('the service line is the quoted buyer fee', /unit_amount: cents\(q\.serviceBuyer\)/.test(purchase))
ok('direct path: application fee from the quote (0.1b)', /application_fee_amount: cents\(q\.applicationFee/.test(purchase))
ok('direct path: on the connected account', /stripeAccount: /.test(purchase))
ok('platform path: transfer_group is the transfer', /transfer_group: transfer\.id/.test(purchase))
ok('3-D Secure requested on purchases (0.6a)', /request_three_d_secure: 'any'/.test(purchase))
ok('an accepted offer charges the accepted amount', /offer\.amount/.test(purchase))
ok('the origin is the app origin, never the caller (0.5a)', /appOrigin\(\)/.test(purchase) && !/request\.headers\.get\('origin'\)/.test(purchase))
ok('the royalty resolves through royaltyOf (0.5b)', /royaltyOf\(/.test(purchase))
ok('the old header comment and inline royalty are gone (0.5d)', !/FUERA de la plataforma/.test(read('src/app/api/stripe/create-purchase/route.ts')) && !/initial_price \* commerce\.royalty_value/.test(purchase))

// ---- no fee outside fees.ts
{
  const offenders: string[] = []
  const files = walk('src/app/api').concat(walk('src/lib'))
  for (let i = 0; i < files.length; i++) {
    if (files[i] === 'src/lib/fees.ts') continue
    const c = code(read(files[i]))
    if (/\b0\.029\b|\bstripePct\b|royalty_value\)? ?\/ ?100|\* ?\(?royalty_value/.test(c)) offenders.push(files[i])
  }
  ok('no route or library computes a fee outside fees.ts', offenders.length === 0, offenders.join(', '))
}

// ---- completion
const sale = code(read('src/lib/complete-sale.ts'))
ok('completeSale exists', /export async function completeSale\(/.test(sale))
ok('it completes in one database transaction', /\.rpc\('complete_sale'/.test(sale))
ok('it stores the amounts (0.9c)', /buyer_total: q\.buyerTotal/.test(sale) && /seller_net: q\.sellerNet/.test(sale) && /application_fee: q\.applicationFee/.test(sale))
ok('it records 3-D Secure (0.6d)', /three_d_secure/.test(sale))
ok('after the transaction: token, provenance, title, notifications', /moveTokenForOwnership\(/.test(sale) && /publishProvenance\(/.test(sale) && /issueTitle\(/.test(sale) && /notify\(/.test(sale))
const callers = walk('src').filter((f) => f !== 'src/lib/complete-sale.ts' && /completeSale\(/.test(code(read(f))))
ok('only the webhooks call completeSale (0.7b)', callers.length > 0 && callers.every((f) => f === 'src/lib/stripe-events.ts'), callers.join(', '))
ok('both webhooks hand events to the same handlers (0.3c)',
   /handleStripeEvent\(/.test(read('src/app/api/stripe/webhook/route.ts')) && /handleStripeEvent\(/.test(read('src/app/api/stripe/connect-webhook/route.ts')) &&
   /STRIPE_CONNECT_WEBHOOK_SECRET/.test(read('src/app/api/stripe/connect-webhook/route.ts')))
ok('complete-transfer no longer completes a purchase', /transfer_type === 'automatic'[\s\S]{0,200}completed_by_webhook/.test(read('src/app/api/complete-transfer/route.ts')))
ok('the success page only reads', !/complete-transfer|complete-sale|method: 'POST'/.test(read('src/app/purchase/success/page.tsx')))
ok('a paid transfer that did not finalise opens a ticket (0.7c)', /capturedButNotFinalized[\s\S]{0,600}|fileSystemTicket\(|from\('tickets'\)\.insert/.test(read('src/app/api/transfer/respond/route.ts')) && /tickets/.test(read('src/app/api/transfer/respond/route.ts')))

// ---- the database side
const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_stage0_sale\.sql$/.test(f)).sort().pop()
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('a stage0_sale migration exists', !!name)
ok('complete_sale is idempotent: a replay changes nothing', /if v_transfer\.payment_status = 'completed' then/.test(mig))
ok('complete_sale locks the row', /for update/.test(mig))
// Two deliveries of one event can both pass the payment_status read before
// either commits; the row lock serialises them, and only the one that
// completed the sale may move the token, open a ticket or issue the title.
ok('complete_sale says whether this call completed the sale',
   /returns jsonb/.test(mig) &&
   /'completed', false/.test(mig) && /'completed', true/.test(mig))
ok('a replay that lost the race does no after-work',
   /if \(!done\.completed\) return \{ status: 'already'/.test(sale) &&
   sale.indexOf('if (!done.completed)') < sale.indexOf('moveTokenForOwnership(') &&
   sale.indexOf('if (!done.completed)') < sale.indexOf("from('tickets')"))
ok('complete_sale is not a public endpoint', /revoke execute on function public\.complete_sale\([^)]*\) from public, anon, authenticated/.test(mig))
const money = ['transfers', 'payout_earnings', 'payout_blocks', 'tbt_payments']
for (let i = 0; i < money.length; i++) {
  const re = new RegExp(`alter table public\\.${money[i]}[\\s\\S]{0,2000}tax_amount[\\s\\S]{0,300}tax_party[\\s\\S]{0,300}tax_country[\\s\\S]{0,300}tax_collected_by`)
  ok(`${money[i]} carries the four tax columns (0.10)`, re.test(mig))
}
ok('the transfer stores the amounts (0.9c)', /add column if not exists buyer_total/.test(mig) && /add column if not exists application_fee/.test(mig) && /add column if not exists charge_path/.test(mig))
ok('3-D Secure is recorded (0.6d)', /add column if not exists satisfied_three_ds/.test(mig))
ok('the first purchase records the Terms (0.8b)', /create table if not exists public\.terms_acceptances/.test(mig))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
