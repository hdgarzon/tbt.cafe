import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 1 — configuration is the single source.
 *
 * Every §3 value is a column of platform_config, read through src/lib/rules.ts.
 * No route restates the number. Making a value editable without making it the
 * only copy turns a stale page into a false one (Registry §5).
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')

/** §3, in order. Existing columns are included: the reader covers them all. */
const COLUMNS = [
  'service_fee_buyer', 'service_fee_seller', 'service_fee_royalty', 'registration_fee', 'transfer_fee',
  'settlement_days_standard', 'settlement_days_high', 'settlement_high_threshold',
  'settlement_days_top', 'settlement_top_threshold',
  'first_payout_hold_days', 'first_payout_clean_sales', 'first_payout_max_days',
  'absorption_threshold', 'writeoff_months',
  'royalty_pct_ceiling', 'royalty_pct_warning', 'royalty_floor_pct', 'royalty_floor_min',
  'transfer_window_hours',
  'offer_max_hours', 'offer_payment_window_hours', 'offer_auto_cancel_days', 'offer_near_expiry_fraction', 'offer_message_max',
  'title_link_days', 'title_link_warning_day',
  'velocity_count_per_hour', 'velocity_outbound_24h', 'velocity_new_pair_days', 'velocity_new_pair_threshold',
  'phone_change_days', 'biometric_threshold', 'three_ds_registration_exempt',
  'payout_platform_pct', 'payout_cost_bank', 'payout_cost_usdc', 'seller_payout_delay_days', 'usdc_enabled',
  'scan_warn', 'scan_block', 'scan_processor_url',
  'pause_registration', 'pause_selling', 'pause_offers', 'pause_transfers', 'pause_payouts',
]
const NEW_COLUMNS = COLUMNS.filter((c) => ['settlement_days_standard', 'settlement_days_high', 'settlement_high_threshold', 'payout_platform_pct', 'biometric_threshold'].indexOf(c) === -1)
const PAUSES = ['registration', 'selling', 'offers', 'transfers', 'payouts']

const apiFiles: string[] = []
const walk = (d: string) => {
  const e = readdirSync(d, { withFileTypes: true })
  for (let i = 0; i < e.length; i++) {
    const p = join(d, e[i].name)
    if (e[i].isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(p)) apiFiles.push(p)
  }
}
walk(join(root, 'src'))

// ---- 1.1 the migration
const migDir = join(root, 'supabase/migrations')
const migName = readdirSync(migDir).filter((f) => /_rules_config\.sql$/.test(f))[0]
ok('a rules_config migration exists', !!migName)
const mig = migName ? readFileSync(join(migDir, migName), 'utf8') : ''
for (let i = 0; i < NEW_COLUMNS.length; i++) {
  ok(`column ${NEW_COLUMNS[i]}`, new RegExp(`add column if not exists ${NEW_COLUMNS[i]}\\b`).test(mig))
}
for (let i = 0; i < PAUSES.length; i++) {
  ok(`pause_${PAUSES[i]}_message carries en, es, pt and fr`,
     new RegExp(`pause_${PAUSES[i]}_message[\\s\\S]{0,120}jsonb`).test(mig) &&
     new RegExp(`check \\(pause_${PAUSES[i]}_message \\?& array\\['en', 'es', 'pt', 'fr'\\]\\)`).test(mig))
}
ok('transfer window under 168 hours', /check \(transfer_window_hours > 0 and transfer_window_hours < 168\)/.test(mig))
ok('royalty ceiling at most 90', /check \(royalty_pct_ceiling >= 0 and royalty_pct_ceiling <= 90\)/.test(mig))
ok('the warning sits under the ceiling', /check \(royalty_pct_warning <= royalty_pct_ceiling\)/.test(mig))
ok('scan fractions between 0 and 1, warn under block', /check \(scan_warn > 0 and scan_warn <= scan_block and scan_block <= 1\)/.test(mig))
ok('near-expiry fraction between 0 and 1', /check \(offer_near_expiry_fraction > 0 and offer_near_expiry_fraction < 1\)/.test(mig))
ok('fees non-negative', /check \(service_fee_buyer >= 0 and service_fee_seller >= 0 and service_fee_royalty >= 0 and registration_fee >= 0 and transfer_fee >= 0\)/.test(mig))
ok('the scanner address is not readable with the public key',
   /revoke select on public\.platform_config from anon, authenticated/.test(mig) &&
   /grant select \([^)]*\) on public\.platform_config to anon, authenticated/.test(mig) &&
   !/grant select \([^)]*scan_processor_url[^)]*\) on public\.platform_config to anon/.test(mig))

// ---- 1.2 one reader
ok('src/lib/rules.ts exists', existsSync(join(root, 'src/lib/rules.ts')))
const rules = existsSync(join(root, 'src/lib/rules.ts')) ? read('src/lib/rules.ts') + (existsSync(join(root, 'src/lib/rules-shape.ts')) ? read('src/lib/rules-shape.ts') : '') : ''
ok('rules.ts reads with the service role', rules.includes('createAdminClient()'))
ok('with a 60-second cache', /RULES_CACHE_MS = 60_000/.test(rules))
const missing = COLUMNS.filter((c) => !rules.includes(`'${c}'`) && !rules.includes(`${c}:`) && !rules.includes(`row.${c}`))
ok('rules.ts maps every column', missing.length === 0, missing.join(', '))

const pub = existsSync(join(root, 'src/lib/rules-public.ts')) ? code('src/lib/rules-public.ts') : ''
ok('a public reader for the browser exists', pub.length > 0)
const shape = code('src/lib/rules-shape.ts')
ok('the public column list leaves out the scanner address', /export function publicRuleColumns[\s\S]{0,200}filter\(\(c\) => c !== 'scan_processor_url'\)/.test(shape))
ok('the browser reader asks only for the public columns', /publicRuleColumns\(\)/.test(pub) && !/select\('\*'\)/.test(pub))
ok('and so does the build-time reader', /getPublicRules[\s\S]{0,700}select\(publicRuleColumns\(\)\)/.test(rules))

const clientImporters = apiFiles.filter((f) => {
  const s = readFileSync(f, 'utf8')
  return /^['"]use client['"]/m.test(s) && /from '@\/lib\/rules'/.test(s)
})
ok('no browser file imports the server reader', clientImporters.length === 0, clientImporters.map((f) => f.slice(root.length + 1)).join(', '))

// ---- the constants are gone from the files §1.2 names
const fees = code('src/lib/fees.ts')
ok('fees.ts keeps only the Stripe rate', /stripePct: 0\.029/.test(fees) && !/service: 8\b/.test(fees) && !/payoutRate: 0\.023/.test(fees) && !/ROYALTY_FLOOR = \{/.test(fees))
ok('LADDER_DEFAULTS is gone', !code('src/lib/auth-ladder.ts').includes('LADDER_DEFAULTS'))
const windowFiles = ['src/lib/transfer-lapse.ts', 'src/app/api/transfer/respond/route.ts', 'src/app/api/transfer/[transferId]/route.ts', 'src/components/work/ActionTab.tsx', 'src/app/api/stripe/webhook/route.ts']
for (let i = 0; i < windowFiles.length; i++) {
  const s = code(windowFiles[i])
  ok(`no hard-coded 24-hour window in ${windowFiles[i]}`, !/24 \* (3600|60 \* 60)/.test(s) && !/HOLD_WINDOW_MS = /.test(s))
}

// ---- 1.3 the scanner
const scanFiles = ['src/lib/image-index.ts', 'src/app/api/tbt-image/describe/route.ts', 'src/app/api/tbt-image/health/route.ts', 'src/app/api/tbt-image/similarity/route.ts']
for (let i = 0; i < scanFiles.length; i++) {
  const s = code(scanFiles[i])
  ok(`${scanFiles[i]} reads the address from configuration`, !s.includes('process.env.TBT_IMAGE_PROCESSOR_URL') && /scanProcessorUrl/.test(s))
}
const sim = code('src/app/api/tbt-image/similarity/route.ts')
ok('the similarity thresholds come from configuration', !/THRESHOLD_(BLOCK|WARN) = 0\./.test(sim) && /scanBlock/.test(sim) && /scanWarn/.test(sim))

// ---- no route restates a fee
const restated = apiFiles.filter((f) => {
  if (f.endsWith('fees.ts') || f.endsWith('rules.ts') || f.endsWith('rules-public.ts')) return false
  const s = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return /FEE\.(service|payoutRate)\b|SERVICE_FEE_CENTS|XFER_FEE\b|ROYALTY_FLOOR\b|REGISTRATION_FEE = /.test(s)
})
ok('no file restates a fee constant', restated.length === 0, restated.map((f) => f.slice(root.length + 1)).join(', '))

// ---- 1.5 operators
const cfg = code('src/app/api/admin/config/route.ts')
ok('the config route reads every rule, the scanner address included', /getRules\(\)/.test(cfg) && /RULE_AUTHORITY/.test(cfg))
ok('an unknown column is refused', /!\(column in RULE_AUTHORITY\)[\s\S]{0,120}unknown_rule/.test(cfg))
ok('a two-person column goes through the approvals',
   /RULE_AUTHORITY\[column\] === 'two_person'[\s\S]{0,400}gateHighRisk\(/.test(cfg))
ok('every rule change needs a reason', /body\.action === 'rule'[\s\S]{0,600}reason_required/.test(cfg))
ok('every rule change is audited', /action: `config\.rule\.\$\{column\}`/.test(cfg))
ok('the cache is dropped after a write', /forgetRules\(\)/.test(cfg))
const page = code('src/app/admin/page.tsx')
ok('the APPLY map forwards the column', /'config\.business_rules': \(a\) => \(\{[\s\S]{0,400}column: \(a\.payload as \{ column\?: string \}\)\?\.column/.test(page))

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
