import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * El e-Mail se verifica con un código — Work Order 01 Step 19 (Addendum A) y Set 3.
 *
 * Esta guarda sostiene:
 *  - la hoja no ata la dirección a auth ni escribe el perfil por su cuenta;
 *  - el código se guarda como hash, caduca, cuenta intentos y se gasta una vez;
 *  - solo un código correcto pone recovery_email_verified en true;
 *  - los textos del Set 3 están tal cual, y "recovery email" desaparece de lo público.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const sql = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const SHEET = code(read('src/components/RecoveryEmailSheet.tsx'))
const BEGIN = code(read('src/app/api/email/begin/route.ts'))
const VERIFY = code(read('src/app/api/email/verify/route.ts'))
const LIB = code(read('src/lib/email-code.ts'))
const M = sql('supabase/migrations/056_email_verification.sql')

// ---- la hoja
{
  ok('no ata la dirección a la identidad de auth', !SHEET.includes('supabase.auth.updateUser('))
  ok('no escribe el perfil desde el navegador', !/from\('profiles'\)/.test(SHEET))
  ok('pide el código al servidor', SHEET.includes("authed('/api/email/begin', { email })"))
  ok('y lo verifica en el servidor', SHEET.includes("authed('/api/email/verify', { code })"))
}

// ---- el código
{
  ok('la tabla es solo del servidor', /alter table public\.email_verifications enable row level security/.test(M) && /revoke all on public\.email_verifications from anon, authenticated/.test(M))
  ok('se guarda el hash, no el código', !/code_hash: code\b/.test(BEGIN) && BEGIN.includes('code_hash: hashCode(code, auth.user.id, row.id)'))
  ok('el hash va atado a la persona y a la solicitud', /tbt-email-code:\$\{userId\}:\$\{requestId\}:\$\{code\}/.test(LIB))
  ok('caduca a los 10 minutos', LIB.includes('export const CODE_TTL_MINUTES = 10') && /interval '10 minutes'/.test(M))
  ok('cinco intentos', LIB.includes('export const CODE_MAX_ATTEMPTS = 5') && VERIFY.includes('req.attempts >= CODE_MAX_ATTEMPTS'))
  ok('pocas solicitudes por hora', BEGIN.includes('(count ?? 0) >= CODE_MAX_PER_HOUR'))
  ok('el error de Resend se lee', BEGIN.includes('const { error: sendError } = await new Resend(apiKey).emails.send('))
  ok('solo cuenta la solicitud más reciente', /\.order\('created_at', \{ ascending: false \}\)\s*\.limit\(1\)/.test(VERIFY))
  ok('un código correcto se gasta una vez', /\.update\(\{ consumed_at: now \}\)\s*\.eq\('id', req\.id\)\s*\.is\('consumed_at', null\)/.test(VERIFY))
  ok('solo entonces se marca verificado', /\.update\(\{ recovery_email: req\.email, recovery_email_verified: true \}\)/.test(VERIFY))
}

// ---- Set 3, tal cual
{
  const SET3: Record<string, [string, string, string, string]> = {
    'authHub.recoveryEmail': ['e-Mail', 'e-Mail', 'e-Mail', 'e-Mail'],
    'recoveryEmail.title': ['e-Mail', 'e-Mail', 'e-Mail', 'e-Mail'],
    'authHub.recoveryHint': ['A second copy of every title link, and a second way to reach you.', 'Una segunda copia de cada enlace a tus títulos, y otra forma de contactarte.', 'Uma segunda cópia de cada link de título, e outra forma de falar com você.', 'Une seconde copie de chaque lien vers vos titres, et un autre moyen de vous joindre.'],
    'recoveryEmail.description': ['Receives a copy of every title link and gives us a second way to reach you. Optional.', 'Recibe una copia de cada enlace a tus títulos y nos da otra forma de contactarte. Opcional.', 'Recebe uma cópia de cada link de título e nos dá outra forma de falar com você. Opcional.', 'Reçoit une copie de chaque lien vers vos titres et nous donne un autre moyen de vous joindre. Facultatif.'],
    'recoveryEmail.checkEmailDesc': ['We sent a code to {email}. Enter it to verify the address.', 'Enviamos un código a {email}. Escríbelo para verificar la dirección.', 'Enviamos um código para {email}. Digite-o para verificar o endereço.', 'Nous avons envoyé un code à {email}. Saisissez-le pour vérifier l’adresse.'],
    'privateCode.pcResetNote': ['Forgot it later? Open a help request.', '¿Lo olvidas luego? Abre una solicitud de ayuda.', 'Esqueceu depois? Abra uma solicitação de ajuda.', 'Oublié plus tard ? Ouvrez une demande d’aide.'],
    'privateCode.pcResetNoteNoEmail': ['Forgot it later? Open a help request.', '¿Lo olvidas luego? Abre una solicitud de ayuda.', 'Esqueceu depois? Abra uma solicitação de ajuda.', 'Oublié plus tard ? Ouvrez une demande d’aide.'],
  }
  const locales = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < locales.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${locales[i]}.json`))
    for (const key of Object.keys(SET3)) {
      const v = key.split('.').reduce((n: any, p) => (n ? n[p] : undefined), m)
      ok(`${locales[i]}: ${key}`, v === SET3[key][i], `tiene ${JSON.stringify(v)}`)
    }
  }
  const legal = read('src/lib/legal-content.ts')
  const roast = read('src/lib/roast-content.ts')
  ok('Terms: los factores ya no incluyen el recovery email', legal.includes('the security factors you add: a private code, and biometric confirmation on your device.'))
  ok('Security: el e-Mail, no el recovery email', legal.includes('<b>e-Mail</b> — gives us a second way to reach you, and receives a copy of every title link. If you forget your private code, open a help request.'))
  ok('Privacy: e-Mail address', legal.includes('and e-Mail address.'))
  ok('Roast: Staying safe', roast.includes('An <b>e-Mail</b> address gives us a second way to reach you, and a second copy of every title link.'))
  ok('ni legal ni Roast dicen "recovery email"', !/recovery email/i.test(legal) && !/recovery email/i.test(roast))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
