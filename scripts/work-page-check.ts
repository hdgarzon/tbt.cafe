import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 8 — the work page shows what the records hold.
 *
 * 8.1 The recording's hash is stored and goes into the registration record; the
 *     recording plays on the Profile tab.
 * 8.2 The asset links show on the work page. The creator, while they hold the
 *     work, edits the live list; the originals are frozen at certification and
 *     shown as "As provided at registration" where they differ.
 * 8.3 Per event: the Solana transaction, the Arweave record and the anchor.
 *     The ledger never hands out the name of a holder who chose not to be named.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_work_page\.sql$/.test(f)).sort().pop()
ok('a work_page migration exists', !!name)
const mig = name ? read(`supabase/migrations/${name}`) : ''
ok('works stores the recording hash', /add column if not exists recording_hash text/.test(mig))
ok('the recording hash has the content-hash shape', /recording_hash ~ '\^sha256:\[0-9a-f\]\{64\}\$'/.test(mig))
ok('works keeps the links as registered', /add column if not exists registered_asset_links text\[\]/.test(mig))
ok('certification freezes the links', /new\.registered_asset_links := coalesce\(new\.asset_links/.test(mig))
ok('only the creator who holds the work edits the live links', /auth\.uid\(\) is distinct from new\.creator_id or auth\.uid\(\) is distinct from new\.current_owner_id/.test(mig))
ok('the registered links never change from the browser', /raise exception 'registered_links_sealed'/.test(mig))
ok('the recording is sealed at certification', /raise exception 'recording_sealed'/.test(mig))
ok('the trigger function is not callable', /revoke execute on function public\.guard_work_page\(\) from public, anon, authenticated/.test(mig))

const brew = code(read('src/lib/brew-data.ts'))
ok('Brew keeps the recording hash instead of discarding it', /recording_hash: recording\?\.hash \?\? null/.test(brew))

const records = code(read('src/lib/chain/records.ts'))
ok('the registration record carries the recording hash', /recording_hash: input\.recordingHash/.test(records))
ok('the recording hash is validated', /assertHash\(input\.recordingHash, 'recording_hash'\)/.test(records))
ok('the registration record carries the asset links', /asset_links: links/.test(records))

const tbt = code(read('src/lib/chain/seal.ts'))
ok('complete-tbt passes the recording hash', /recordingHash: workWithCreator\.recording_hash \?\? undefined/.test(tbt))
ok('complete-tbt passes the links as registered', /assetLinks: workWithCreator\.registered_asset_links \?\? workWithCreator\.asset_links \?\? undefined/.test(tbt))

const ledger = code(read('src/app/api/work/[tbtId]/ledger/route.ts'))
ok('the ledger returns the token move per event', /solanaSignature: h\.token_move_signature/.test(ledger))
ok('the ledger hands out no raw holder name', !/owner_name/.test(ledger) && !/previous_owner_name/.test(ledger))

const history = code(read('src/components/work/HistoryTab.tsx'))
ok('History links the Solana transaction', /explorer\.solana\.com\/tx\/\$\{entry\.solanaSignature\}/.test(history))
ok('History links the asset for the registration', /explorer\.solana\.com\/address\/\$\{mintAddress\}/.test(history))

const profile = code(read('src/components/work/ProfileTab.tsx'))
ok('the recording plays on the Profile tab', /<audio[\s\S]*?src=\{work\.audio_video_url\}/.test(profile) && /<video[\s\S]*?src=\{work\.audio_video_url\}/.test(profile))
ok('the links show on the Profile tab', /const live = work\.asset_links \?\? \[\]/.test(profile) && /live\.map\(/.test(profile))
ok('the originals are labelled where they differ', /t\.work\.linksAsRegistered/.test(profile) && /linksDiffer\(/.test(profile))
ok('only the holder-creator gets the editor', /canEditLinks=\{/.test(read('src/app/work/[tbtId]/WorkClient.tsx')))

// Sin quitar comentarios: el `//` de una expresion regular parece uno.
const data = read('src/lib/work-data.ts')
ok('the work loads its links and recording', /asset_links, registered_asset_links, audio_video_url, audio_video_type/.test(data))
ok('links are saved as http(s) only', /saveAssetLinks/.test(data) && /\^https\?:\\\/\\\//.test(data))

const langs = ['en', 'es', 'pt', 'fr']
for (let i = 0; i < langs.length; i++) {
  const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
  ok(`${langs[i]}: link and recording copy`, ['linksHeading', 'linksAsRegistered', 'linkAdd', 'recordingHeading', 'linkTx'].every((k) => typeof m.work?.[k] === 'string'))
}
ok('en: the spec wording', JSON.parse(read('src/i18n/messages/en.json')).work.linksAsRegistered === 'As provided at registration')

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
