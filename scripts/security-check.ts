import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Work Order 02, Stage 10 — security and velocity.
 *
 * The private code cannot change on a session alone; a biometric cannot be
 * added or removed from the browser; a phone change inside the rate limit is
 * refused; a pending transfer follows its recipient to the new number;
 * velocity rules challenge rather than refuse, except the new-pair hold.
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
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_security\.sql$/.test(f)).sort().pop()
  ok('a security migration exists', !!name)
  const mig = name ? code(`supabase/migrations/${name}`) : ''

  // ---- 10.1 the factors
  ok('the browser only reads its credentials', /drop policy if exists "own credentials" on public\.webauthn_credentials/.test(mig) &&
     /create policy "[^"]+" on public\.webauthn_credentials\s+for select using/.test(mig) &&
     /revoke insert, update, delete on public\.webauthn_credentials from anon, authenticated/.test(mig))
  const pc = code('src/app/api/private-code/route.ts')
  ok('changing or removing a code needs the current code and biometric', /private_code_hash[\s\S]{0,300}verifyTwoFactors\(/.test(pc) && (pc.match(/verifyTwoFactors\(/g) ?? []).length >= 2)
  ok('the code is written with the service role, not the session', !/clientFor\(token\)[\s\S]{0,200}\.update\(/.test(pc) && /createAdminClient\(\)/.test(pc))
  ok('a new or changed code is announced', /eventKey: 'security_change'/.test(pc))
  const rm = code('src/app/api/webauthn/credential/route.ts')
  ok('removing a biometric requires the private code', /export async function DELETE/.test(rm) && /verifyPrivateCode\(/.test(rm))
  ok('a new biometric is announced', /eventKey: 'security_change'/.test(code('src/app/api/webauthn/register/finish/route.ts')))
  const nt = code('src/lib/notify.ts')
  ok('security_change is a security key that cannot be silenced', /security_change: 'security'/.test(nt) && /'security_change'/.test(nt.slice(nt.indexOf('ALWAYS_ON'), nt.indexOf('CATEGORY_OF'))))

  // ---- 10.3 the reset
  const reset = code('src/app/api/admin/private-code-reset/route.ts')
  ok('the reset goes through two people', /'private_code\.reset'/.test(reset) && /gateHighRisk\(/.test(reset))
  ok('it clears the code and tells the person', /private_code_hash: null/.test(reset) && /eventKey: 'security_change'/.test(reset))
  ok('it is high risk with an APPLY entry', /'private_code\.reset'/.test(code('src/lib/admin/guard.ts')) && /'private_code\.reset': \(a\) =>/.test(code('src/app/admin/page.tsx')))

  // ---- 10.2 the phone change
  const phone = code('src/app/api/phone/change/route.ts')
  ok('the phone change needs code, biometric and the new number', /verifyTwoFactors\(/.test(phone) && /verifyOtp\(/.test(phone))
  ok('at most one per phone_change_days', /phoneChangeDays/.test(phone) && /'rate_limited'/.test(phone))
  ok('the alarm goes to the old number and the e-Mail', /eventKey: 'security_change'/.test(phone) && /oldPhone/.test(phone))
  ok('pending transfers follow the recipient', /new_owner_phone: newPhone/.test(phone) && /readdressed/.test(phone))
  ok('the window keeps running from the original authorisation', !/authorized_at:/.test(phone))
  ok('the change is recorded', /phone_changed_at/.test(mig))
  const auth = code('src/app/settings/authentication/page.tsx')
  ok('Authentication settings open the phone change, no placeholder', /<PhoneChangeSheet/.test(auth) && !/alert\(/.test(auth))
  ok('the private code sheet asks the current code and biometric when one exists', /hasCode \? \{ currentCode: current, biometricProof: bio\.proof \}/.test(code('src/components/PrivateCodeSheet.tsx')))

  // ---- 10.4 velocity
  const lad = code('src/lib/auth-ladder-server.ts')
  ok('count and value challenge, never refuse', /velocityCheck\(/.test(lad) && /'challenge'/.test(code('src/lib/velocity.ts')))
  ok('a new pair above the threshold is held for review', /'hold'/.test(code('src/lib/velocity.ts')) && /velocity_holds/.test(mig))
  ok('suspicious fires on a challenge', /eventKey: 'suspicious'/.test(code('src/lib/velocity.ts')))

  const langs = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    ok(`${langs[i]}: Set 4.6 and security notices`,
       ['change', 'changeNote', 'rateLimited', 'noFactor', 'changed'].every((k) => typeof m.phone?.[k] === 'string') &&
       ['security_change_phone', 'security_change_factor', 'security_change_reset', 'suspicious'].every((k) => typeof m.feed?.events?.[k] === 'string'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
