import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 12 — the keys this order creates are wired.
 *
 * Each has a category; security_change cannot be silenced; each has its
 * feed text in four languages; new_location stays declared with its reason.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const notify = read('src/lib/notify.ts')
const always = notify.slice(notify.indexOf('const ALWAYS_ON'), notify.indexOf('const CATEGORY_OF'))
const categories = notify.slice(notify.indexOf('const CATEGORY_OF'))

const TRANSACTIONAL = ['offer_received', 'offer_accepted', 'offer_declined', 'offer_expiring', 'offer_withdrawn', 'offer_expired', 'offer_cancelled', 'offer_holder_ready', 'selling_status']
for (let i = 0; i < TRANSACTIONAL.length; i++) {
  ok(`${TRANSACTIONAL[i]} is transactional`, new RegExp(`\\b${TRANSACTIONAL[i]}: 'transactional'`).test(categories))
}
ok('security_change is security', /security_change: 'security'/.test(categories))
ok('security_change cannot be silenced', /'security_change'/.test(always))
ok('new_location stays declared, with its reason', /Declarada y sin disparar[\s\S]{0,200}new_location: 'security'/.test(notify))

// The feed text for every key and variant this order fires.
const FEED = [
  'offer_received', 'offer_received_unapproved', 'offer_received_message', 'offer_received_unapproved_message',
  'offer_accepted', 'offer_declined', 'offer_expiring', 'offer_withdrawn', 'offer_expired', 'offer_cancelled', 'offer_holder_ready',
  'selling_status_approved', 'selling_status_declined', 'selling_status_suspended', 'selling_status_reinstated',
  'security_change_phone', 'security_change_factor', 'security_change_reset', 'suspicious', 'transfers_readdressed',
]
const langs = ['en', 'es', 'pt', 'fr']
for (let i = 0; i < langs.length; i++) {
  const events = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`)).feed.events
  const missing = FEED.filter((k) => typeof events[k] !== 'string' || !events[k].trim())
  ok(`${langs[i]}: every Stage 12 notice has its text`, missing.length === 0, missing.join(', '))
}

// A seller's pause or suspension cancels live offers (Stage 12 table).
const srv = read('src/lib/offers-server.ts')
const lapse = srv.slice(srv.indexOf('export async function lapseOffersOfHolder'), srv.indexOf('export async function tellBuyersHolderReady'))
ok('a seller pause or suspension cancels live offers and says so', /status: 'cancelled'/.test(lapse) && /eventKey: 'offer_cancelled'/.test(lapse))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
