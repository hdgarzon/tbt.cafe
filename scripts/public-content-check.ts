import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ROAST_ARTICLES } from '../src/lib/roast-content'

/**
 * Chains 01, Stage 12 (decision 75) — public content follows operation.
 *
 * Each claim about the chains says what the chains do once option C runs: the
 * royalty is written when it locks; the token moves to each holding's own
 * address; the Bitcoin proof is published beside its record; tbt.cafe pays once
 * per record; the image goes at full size unless the creator chooses otherwise;
 * no key is held for any holder. A new article explains the anonymous option,
 * how to derive a holding address, and the storage key that signs the records.
 * The privacy policy names what is permanent and public.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')

const roast = JSON.stringify(ROAST_ARTICLES)
ok('roast: the royalty no longer "travels with the token"', !/travels with the token/.test(roast))
ok('roast: the royalty is written when it locks', /written to the permanent record when it locks and can never change/.test(roast))
ok('roast: the proof is published beside its record', /Each Bitcoin proof is published to Arweave beside its record/.test(roast) && !/proof file we store alongside/.test(roast))
ok('roast: tbt.cafe pays once per record', /tbt\.cafe pays once for each record; nothing needs paying again/.test(roast) && !/nobody at tbt\.cafe operates or pays for/.test(roast))
ok('roast: the image at full size by default', /at full size unless the creator chooses otherwise/.test(roast))
ok('roast: the token moves to each holding', /moves the token to the new holding’s own address on Solana/.test(roast))

const anon = ROAST_ARTICLES.find((a) => a.id === 'staying-anonymous')
const anonText = JSON.stringify(anon ?? {})
ok('roast: the anonymous-option article exists', !!anon)
ok('it explains the choice at each acquisition', /Private collector/.test(anonText) && /cannot be removed/.test(anonText))
ok('it gives the holding-address derivation', /tbt-holding/.test(anonText) && /F9ieqDeu9tk2eBeMLXdRdtyagHVhdR9uNbqqJBjPgg3q/.test(anonText))
ok('it names the storage key through the prose value', /\{storage_address\}/.test(anonText))
const prose = read('src/lib/prose.ts')
ok('the storage address is a prose value from configuration', /storage_address: process\.env\.NEXT_PUBLIC_TBT_STORAGE_ADDRESS/.test(prose) && /'storage_address'/.test(prose))

const knowledge = read('src/lib/assistant/knowledge.ts')
ok('assistant: the Seal no longer puts price and royalty in the record', !/and all of that goes into the permanent record/.test(knowledge))
ok('assistant: the declared value is sealed; prices and the royalty are added', /its context and its declared value are sealed into the permanent record/.test(knowledge))

const legal = read('src/lib/legal-content.ts')
ok('terms: no key is held for any holder', /tbt\.cafe holds the keys that record and move TBTs; no key is created or held for any holder/.test(legal))
ok('privacy: what is permanent and public', /signature’s fingerprint \(not the signature\)/.test(legal) && /holder names only when chosen/.test(legal))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
