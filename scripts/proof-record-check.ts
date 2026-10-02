import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, 6.3 and 6.4 — a confirmed Bitcoin proof is published to Arweave.
 *
 * When an anchor confirms, its complete .ots proof goes up as a proof record
 * beside the record it anchors, and its ID is kept in
 * chain_anchors.proof_record_id. That is what lets the anchor be checked after
 * tbt.cafe is gone. A confirmed anchor with no proof record is picked up on the
 * next run; a proof record is never itself anchored. The work page links it.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_proof_records\.sql$/.test(f)).sort().pop()
ok('a proof_records migration exists', !!name)
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('chain_anchors keeps the proof record ID', /add column if not exists proof_record_id text/.test(mig))
ok('chain_anchors knows its work', /add column if not exists tbt_id text/.test(mig))

const pub = read('src/lib/chain/proof-publish.ts')
ok('confirmed anchors without a proof are picked up', /\.eq\('status', 'confirmed'\)/.test(pub) && /\.is\('proof_record_id', null\)/.test(pub))
ok('the proof record is built from the stored proof', /proofRecord\(\{/.test(pub) && /otsProof: fromBytea\(/.test(pub))
ok('a proof is never re-published', /\.update\(\{ proof_record_id: arweaveId\(published\.uri\) \}\)[\s\S]{0,120}\.is\('proof_record_id', null\)/.test(pub))

const cron = read('src/app/api/cron/anchor-upgrade/route.ts')
ok('the upgrade run publishes the proofs', /await publishProofs\(admin\)/.test(cron))

const ots = read('src/lib/chain/ots.ts')
const ar = read('src/lib/chain/arweave.ts')
ok('an anchor records its work', /tbt_id: tbtId/.test(ots) && /anchorRecord\(hash, record\.type as RecordKind, uri, record\.tbt_id\)/.test(ar))

const ledger = read('src/app/api/work/[tbtId]/ledger/route.ts')
ok('the ledger returns the proof record', /proofRecordId: a\.proof_record_id/.test(ledger))
const history = read('src/components/work/HistoryTab.tsx')
ok('History links the proof on Arweave', /arweaveUrl\(entry\.anchor\.proofRecordId\)/.test(history))

const en = JSON.parse(read('src/i18n/messages/en.json'))
ok('en: the 6.4 wording', en.work.anchorConfirmed === 'anchored to Bitcoin, block {height}' && en.work.anchorPending === 'anchoring')
const langs = ['es', 'pt', 'fr']
for (let i = 0; i < langs.length; i++) {
  const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
  ok(`${langs[i]}: proof link copy`, typeof m.work?.linkProofRecord === 'string' && /\{height\}/.test(m.work?.anchorConfirmed ?? ''))
}

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
