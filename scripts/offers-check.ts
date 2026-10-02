import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 4 — offers.
 *
 * Status changes only through the routes and the sweep; accept refuses
 * without an active seller state; a frozen work refuses commerce changes and
 * transfers; no SMS or e-Mail template contains the message text; the report
 * category exists.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

function walk(dir: string, out: string[]): string[] {
  const e = readdirSync(dir, { withFileTypes: true })
  for (let i = 0; i < e.length; i++) {
    const p = join(dir, e[i].name)
    if (e[i].isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

async function main() {
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_offers\.sql$/.test(f)).sort().pop()
  ok('an offers migration exists', !!name)
  const mig = name ? code(`supabase/migrations/${name}`) : ''

  // ---- 4.1 schema
  const cols = ['duration_hours', 'expires_at', 'message', 'response_message', 'responded_at', 'accepted_at', 'payment_due_at', 'auto_cancel_at', 'closed_at', 'close_reason', 'halfway_reminded_at', 'near_reminded_at', 'suspended']
  ok('offers gains every column', cols.every((c) => new RegExp(`add column if not exists ${c}\\b`).test(mig)), cols.filter((c) => !new RegExp(`add column if not exists ${c}\\b`).test(mig)).join(', '))
  ok('the seven statuses', /check \(status in \('open', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled', 'completed'\)\)/.test(mig))
  ok('durations are 24, 48 or 72', /check \(duration_hours in \(24, 48, 72\)\)/.test(mig))
  ok('offer_events is append-only', /create table if not exists public\.offer_events/.test(mig) && /before update on public\.offer_events/.test(mig))
  ok('the client insert policy is gone', /drop policy if exists "offerer writes" on public\.offers/.test(mig))
  ok('clients cannot write offers', /revoke insert, update, delete on public\.offers from anon, authenticated/.test(mig))
  ok('the report category exists', /category in \([^)]*'report'[^)]*\)/.test(mig))

  // ---- status changes only through the routes and the sweep
  const files = walk(join(root, 'src'), [])
  const writers = files.filter((f) => /from\('offers'\)\s*\.(update|insert|upsert)\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1))
  const allowed = ['src/lib/offers-server.ts', 'src/lib/offer-sweep.ts']
  ok('only the offers server module and the sweep write offers', writers.every((f) => allowed.indexOf(f) !== -1), writers.join(', '))
  ok('no browser file writes offers', !files.some((f) => /^['"]use client['"]/m.test(readFileSync(f, 'utf8')) && /from\('offers'\)\s*\.(update|insert)/.test(readFileSync(f, 'utf8'))))

  const lib = code('src/lib/offers.ts')
  ok('src/lib/offers.ts exists', lib.length > 0)
  ok('the duration never exceeds offer_max_hours', /offers\.maxHours/.test(lib))
  ok('the message is bounded by configuration', /offers\.messageMax/.test(lib))
  ok('an offer below the fixed-royalty floor is refused', /minPriceFor\([\s\S]{0,120}'below_floor'/.test(lib))
  ok('offers need taking_offers and no global pause', /taking_offers[\s\S]{0,200}pauses\.offers\.on/.test(lib))

  const srv = code('src/lib/offers-server.ts')
  ok('accept refuses without an active seller state', /accept[\s\S]{0,600}canSell\([\s\S]{0,200}'need_approval'/.test(srv))
  ok('accept refuses a frozen work', /frozen_offer_id[\s\S]{0,120}'frozen'/.test(srv))
  ok('accept freezes the work for this offer', /frozen_offer_id: offer\.id/.test(srv))
  ok('accept suspends the other open offers, untold', /suspended: true/.test(srv))
  ok('payment window and auto-cancel come from configuration', /offers\.paymentWindowHours/.test(srv) && /offers\.autoCancelDays/.test(srv))
  ok('every change is logged', /from\('offer_events'\)\.insert\(/.test(srv))
  ok('non-payment cancel clears the freeze and reopens', /cancelUnpaid[\s\S]{0,1500}frozen_offer_id: null[\s\S]{0,800}suspended: false/.test(srv))
  ok('seller pause and suspension lapse live offers', /export async function lapseOffersOfHolder/.test(srv) &&
     /lapseOffersOfHolder\(/.test(code('src/app/api/selling/route.ts')) && /lapseOffersOfHolder\(/.test(code('src/app/api/admin/sellers/route.ts')))
  ok('approval tells the buyers whose offer lapsed unapproved', /offer_holder_ready/.test(code('src/app/api/admin/sellers/route.ts')) || /offer_holder_ready/.test(srv))

  // ---- a frozen work refuses transfers (commerce is in check:lock)
  ok('transfer creation refuses a frozen work', /frozen_offer_id[\s\S]{0,200}'work_frozen'/.test(code('src/app/api/transfer/create/route.ts')))

  // ---- the sweep
  const sweep = code('src/lib/offer-sweep.ts')
  ok('the sweep reminds at halfway and near expiry', /halfway_reminded_at/.test(sweep) && /near_reminded_at/.test(sweep) && /nearExpiryFraction/.test(sweep))
  ok('the sweep expires and auto-cancels', /'expired'/.test(sweep) && /cancelUnpaid\(/.test(sweep))

  // ---- no message text in SMS or e-Mail
  const email = code('src/lib/email-templates.ts')
  ok('no e-Mail template interpolates an offer message', !/p\.message\b|p\.response_message\b|p\.reply\b/.test(email))
  const notifyCalls = srv.match(/notify\([\s\S]*?\}\)/g) ?? []
  ok('notifications never carry the message text', notifyCalls.length > 0 && notifyCalls.every((c) => !/message:|response_message|reply:/.test(c)))

  // ---- 4.12, 4.13 the surfaces
  ok('a feed row with an offer opens its sheet in place', /openOffer\(offerId\)/.test(code('src/components/NotificationFeed.tsx')))
  ok('the shell mounts the offer sheet and reads ?offer=', /<OfferSheet offerId=\{offerId\}/.test(code('src/components/AppShell.tsx')) && /params\.get\('offer'\)/.test(code('src/components/AppShell.tsx')))
  const sheet = code('src/components/offers/OfferSheet.tsx')
  ok('the holder sees Accept, Decline and a reply', /act\('accept'\)/.test(sheet) && /act\('decline'\)/.test(sheet) && /t\.offer\.reply/.test(sheet))
  ok('Accept explains and routes to Selling without approval (S-3)', /need_approval[\s\S]{0,80}setNeedApproval/.test(sheet) && /\/settings\/selling/.test(sheet))
  ok('the offerer can withdraw, with a confirmation', /act\('withdraw'\)/.test(sheet) && /withdrawConfirm/.test(sheet))
  ok('each message can be reported', /act\('report', confirmReport\)/.test(sheet))
  ok('the sheet carries the elsewhere line', /t\.offer\.elsewhere/.test(sheet))
  const hist = code('src/app/history/offers/page.tsx')
  ok('History → Offers opens the sheet and counts down', /openOffer\(r\.id\)/.test(hist) && /useCountdown\(/.test(hist))
  const wc = code('src/app/work/[tbtId]/WorkClient.tsx')
  ok('the work page shows the frozen state', /offerCtx\?\.frozenUntil/.test(wc) && /t\.work\.frozen/.test(wc))
  ok('the make-offer sheet asks duration and message', /durationsFor\(rules\)/.test(wc) && /t\.offer\.message/.test(wc))
  ok('it warns S-2 or not covered before sending', /t\.offer\.unapproved/.test(wc) && /t\.offer\.notCovered/.test(wc))

  // ---- keys and strings
  const nt = code('src/lib/notify.ts')
  const keys = ['offer_withdrawn', 'offer_expired', 'offer_cancelled', 'offer_holder_ready']
  ok('the new offer keys are transactional', keys.every((k) => new RegExp(`${k}: 'transactional'`).test(nt)))
  const langs = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    ok(`${langs[i]}: Set 4.3 offer strings`, !!m.offer && ['title', 'amount', 'duration', 'hours', 'message', 'elsewhere', 'unapproved', 'notCovered', 'belowFloor', 'send', 'respond', 'accept', 'decline', 'reply', 'needApproval', 'withdraw', 'withdrawConfirm', 'acceptedBuyer', 'pay', 'expiresIn', 'sellerCancel', 'report', 'reportConfirm', 'reported'].every((k) => typeof m.offer[k] === 'string'))
    ok(`${langs[i]}: Set 4.8 offer notifications`, ['offer_received', 'offer_received_unapproved', 'offer_accepted', 'offer_declined', 'offer_expiring', 'offer_withdrawn', 'offer_expired', 'offer_cancelled', 'offer_holder_ready'].every((k) => typeof m.feed?.events?.[k] === 'string'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
