import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, 0.3a, 0.3c and 2.5 — the direct path can actually charge.
 *
 * A direct-path seller's connected account carries the merchant configuration
 * with card payments requested, beside the recipient configuration. Until
 * Stripe reports card payments active, no sale is sent to that account: the
 * charge would be refused at the provider, after the buyer pressed Pay.
 * account.updated keeps the stored state current.
 *
 * 6.5: once the account can take charges, its settlement delay is set to
 * seller_payout_delay_days, so the money is still there when a dispute lands.
 * Stripe accepts at most 31, so the configuration cannot hold more.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

async function main() {
  // ---- the stored state
  const migName = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_connect_merchant\.sql$/.test(f))[0]
  ok('a connect_merchant migration exists', !!migName)
  const mig = migName ? code(`supabase/migrations/${migName}`) : ''
  ok('payout_connect_accounts records card payments',
     /alter table public\.payout_connect_accounts\s+add column if not exists card_payments_enabled boolean not null default false/.test(mig))
  ok('the snapshot carries the column', /card_payments_enabled boolean default false not null/.test(read('supabase/schema-snapshot.sql')))

  // ---- 0.3a / 2.5 onboarding requests both configurations for a direct seller
  const connect = code('src/app/api/payouts/connect/route.ts')
  ok('onboarding reads the seller path', /from\('seller_accounts'\)[\s\S]{0,120}charge_path/.test(connect))
  ok('a new direct account requests card payments',
     /merchant: \{ capabilities: \{ card_payments: \{ requested: true \} \} \}/.test(connect))
  ok('an existing account gains the merchant configuration', /stripe\.v2\.core\.accounts\.update\(/.test(connect))
  ok('the link onboards merchant and recipient together', /configurations: direct \? \['merchant', 'recipient'\] : \['recipient'\]/.test(connect))
  ok('responsibilities stay with the platform',
     /fees_collector: 'application', losses_collector: 'application'/.test(connect) && /dashboard: 'express'/.test(connect))

  // ---- the refresh reads both capabilities
  const refresh = code('src/lib/payout-disburse.ts')
  ok('the refresh includes the merchant configuration', /include: \['configuration\.merchant', 'configuration\.recipient'\]/.test(refresh))
  ok('card payments are read from the merchant capability', /configuration\?\.merchant\?\.capabilities\?\.card_payments/.test(refresh))
  ok('and stored', /card_payments_enabled: cardPaymentsEnabled/.test(refresh))

  // ---- 0.3c account.updated
  const events = code('src/lib/stripe-events.ts')
  ok('account.updated is handled', /case 'account\.updated':/.test(events))
  ok('it refreshes the stored account', /refreshConnectAccount\(/.test(events))
  ok('an unknown account is ignored, not created', /from\('payout_connect_accounts'\)[\s\S]{0,200}eq\('account_id'/.test(events))

  // ---- 6.5 the payout delay
  ok('the delay cannot exceed what Stripe accepts',
     /add constraint rules_payout_delay_max check \(seller_payout_delay_days <= 31\)/.test(mig))
  ok('the snapshot carries the cap', /rules_payout_delay_max check \(seller_payout_delay_days <= 31\)/.test(read('supabase/schema-snapshot.sql')))
  ok('the delay is set on the connected account',
     /balanceSettings\.update\(\s*\{ payments: \{ settlement_timing: \{ delay_days_override: rules\.payouts\.sellerDelayDays \} \} \},\s*\{ stripeAccount: accountId \}/.test(events))
  ok('only once it can take charges', /if \(fresh\.cardPaymentsEnabled\)[\s\S]{0,200}balanceSettings\.update\(/.test(events))
  ok('a failure asks Stripe to resend', /payout_delay_not_set/.test(events))

  // ---- no sale reaches an account that cannot take it
  const purchase = code('src/app/api/stripe/create-purchase/route.ts')
  ok('the direct branch reads card payments', /select\('account_id, card_payments_enabled'\)/.test(purchase))
  ok('and refuses before the Checkout Session', /!connect\?\.card_payments_enabled\) return NextResponse\.json\(\{ error: 'seller_not_ready' \}/.test(purchase))

  // ---- 2.5 the screen shows active only once the provider says so
  const selling = code('src/app/api/selling/route.ts')
  ok('a direct seller is ready only with card payments',
     /charge_path === 'direct'[\s\S]{0,120}card_payments_enabled/.test(selling))
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad ? 1 : 0)
})
