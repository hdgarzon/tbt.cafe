import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 5 — transfers.
 *
 * No literal window anywhere; accept refuses a different phone; every
 * completed transfer carries value_kind and the confirmation time; transfer
 * creation refuses a frozen work; the ladder gates on the greater value.
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
    else if (/\.(ts|tsx|json)$/.test(p)) out.push(p)
  }
  return out
}

async function main() {
  // ---- 5.1 no literal window anywhere (code, strings, e-Mails)
  const files = walk(join(root, 'src'), [])
  const literal = files.filter((f) => {
    const s = f.endsWith('.json') ? readFileSync(f, 'utf8') : readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    return /\b24 \* 3600\b|\b24 (hours|horas|heures) to respond|within 24 hours|dentro de (las )?24 horas|em 24 horas|dans les 24 heures|Expires in 24 hours/.test(s)
  })
  ok('no literal transfer window anywhere', literal.length === 0, literal.map((f) => f.slice(root.length + 1)).join(', '))

  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_transfer_value\.sql$/.test(f)).sort().pop()
  ok('a transfer_value migration exists', !!name)
  const mig = name ? code(`supabase/migrations/${name}`) : ''
  ok('transfers carry the value kind', /add column if not exists value_kind text/.test(mig) && /check \(value_kind in \('declared', 'gift', 'sale', 'restoring'\)\)/.test(mig))
  ok('and the confirmation time', /add column if not exists declared_value_confirmed_at timestamptz/.test(mig))
  ok('and the naming choice', /add column if not exists holder_named boolean/.test(mig))

  // ---- 5.2 the right recipient
  const respond = code('src/app/api/transfer/respond/route.ts')
  ok('accept compares the authenticated phone with the recipient', /samePhone\(/.test(respond) && /new_owner_phone/.test(respond))
  ok('a different phone gets 403 and nothing else', /'wrongNumber'[\s\S]{0,40}status: 403/.test(respond) && !/new_owner_phone[^\n]*NextResponse\.json/.test(respond))

  // ---- 5.3 the value confirmed at acceptance
  ok('accept records the confirmation and the choice', /declared_value_confirmed_at: /.test(respond) && /holder_named: /.test(respond))
  const create = code('src/app/api/transfer/create/route.ts')
  ok('creation records the value kind', /value_kind: /.test(create))
  ok('creation refuses a frozen work', /frozen_offer_id[\s\S]{0,200}'work_frozen'/.test(create))
  ok('the ladder gates on the greater of declared and last recorded value (5.7)', /Math\.max\(recordedValue, await lastRecordedValue\(/.test(create))
  const complete = code('src/app/api/complete-transfer/route.ts')
  ok('completion refuses a transfer without its value kind and confirmation', /!transfer\.value_kind \|\| !transfer\.declared_value_confirmed_at/.test(complete))

  // ---- 5.3, 5.4, 5.5 the screens
  const accept = code('src/app/transfer/accept/[transferId]/page.tsx')
  ok('the accept page always shows the value line', /transferAccept\.declared/.test(accept) && /transferAccept\.gift/.test(accept) && /transferAccept\.confirmNote/.test(accept))
  ok('the accept page asks the naming question', /holder\.nameQuestion/.test(accept) && /holder\.nameNote/.test(accept) && /collector_anonymous/.test(accept))
  ok('the accept page explains a wrong number', /transferAccept\.wrongNumber/.test(accept))
  ok('the create screen carries the elsewhere line', /t\.transfer\.elsewhere/.test(code('src/components/work/TransferPanel.tsx')))

  const langs = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    ok(`${langs[i]}: Set 4.4 transfer strings`,
       typeof m.holder?.nameQuestion === 'string' && typeof m.holder?.nameNote === 'string' && typeof m.transfer?.elsewhere === 'string' &&
       ['declared', 'gift', 'confirmNote', 'wrongNumber'].every((k) => typeof m.transferAccept?.[k] === 'string') &&
       m.transfer?.authoriseNote?.includes('{hours}') && m.transferAccept?.lapsedBody?.includes('{hours}'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
