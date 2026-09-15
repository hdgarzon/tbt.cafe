import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Un escaneo que no corrió no es un escaneo limpio — Update Package 01, N9 (b–g).
 *
 * `status === 'skipped' ? 'clear' : status` convertía cualquier fallo del
 * procesador —caído, sin URL, clave rechazada— en "sin conflictos". Con el
 * índice vacío, además, cada escaneo salía limpio por no tener contra qué
 * comparar. La comprobación de originalidad nunca funcionó y la interfaz decía
 * que sí.
 *
 * Esta guarda sostiene:
 *  - ningún fallo se lee como limpio, y un 401 no se confunde con una caída;
 *  - con el procesador caído el registro se pausa: aviso en el inicio, Brew no
 *    abre el flujo, y el aviso se va solo cuando vuelve;
 *  - si cae a mitad del flujo, se avisa y se cierra, antes de crear nada;
 *  - cada intento fallido queda en provider_events, con la causa de configuración
 *    separada de la caída;
 *  - la página de la obra deja de afirmar un escaneo y una huella que no existen.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

const BREW_DATA = code(read('src/lib/brew-data.ts'))
const WIZARD = code(read('src/components/brew/BrewWizard.tsx'))
const ESPRESSO = code(read('src/components/brew/EspressoFlow.tsx'))
const SIMILARITY = code(read('src/app/api/tbt-image/similarity/route.ts'))
const HEALTH = code(readIf('src/app/api/tbt-image/health/route.ts'))
const HOME = code(read('src/app/page.tsx'))
const INFO = code(read('src/components/work/InfoTab.tsx'))

// ---- (b) ningún fallo se lee como limpio
{
  const FILES: [string, string][] = [['brew-data', BREW_DATA], ['BrewWizard', WIZARD], ['EspressoFlow', ESPRESSO], ['similarity', SIMILARITY]]
  for (let i = 0; i < FILES.length; i++) {
    ok(`${FILES[i][0]}: no queda el estado 'skipped'`, !FILES[i][1].includes("'skipped'"), "un escaneo que no corrió se pintaba como 'clear'")
  }
  ok('un 401 es falta de sesión, no una caída', BREW_DATA.includes("if (res.status === 401) return { status: 'unauthenticated' }"))
  ok('cualquier otra respuesta no-ok es no disponible', BREW_DATA.includes("if (!res.ok) return { status: 'unavailable' }"))
  ok('un fallo de red también', /catch \{\s*return \{ status: 'unavailable' \}/.test(BREW_DATA))
}

// ---- (f) la ruta del escaneo distingue configuración de caída, y lo registra
{
  ok('lee la configuración al atender, no al importar', /export async function POST[\s\S]*process\.env\.TBT_IMAGE_PROCESSOR_URL/.test(SIMILARITY))
  ok('sin URL: configuración', /if \(!url\) return unavailable\('setup', 'url_unset'\)/.test(SIMILARITY))
  ok('sin clave: configuración', /if \(!key\) return unavailable\('setup', 'key_missing'\)/.test(SIMILARITY))
  ok('clave rechazada: configuración', /response\.status === 401 \|\| response\.status === 403\) return unavailable\('setup', 'key_rejected'\)/.test(SIMILARITY))
  ok('otra respuesta no-ok: caída', /if \(!response\.ok\) return unavailable\('outage', `http_\$\{response\.status\}`\)/.test(SIMILARITY))
  ok('una excepción: caída', /catch \(error\) \{\s*return unavailable\('outage', 'unreachable', error\)/.test(SIMILARITY))
  ok('no disponible responde 503', SIMILARITY.includes("NextResponse.json({ status: 'unavailable', reason }, { status: 503 })"))
  ok('el fallo queda en provider_events', /recordProviderEvent\(\{ provider: 'image_processor', operation: 'search_images', ok: false/.test(SIMILARITY))
  ok('y el escaneo que sí corrió también', /recordProviderEvent\(\{ provider: 'image_processor', operation: 'search_images', ok: true/.test(SIMILARITY))
}

// ---- (c, e) comprobación previa: /health
{
  ok('existe la ruta de estado', HEALTH.length > 0)
  ok('no pide sesión: el aviso lo ve cualquiera en el inicio', !HEALTH.includes('authenticate('))
  ok('es dinámica', HEALTH.includes("export const dynamic = 'force-dynamic'"))
  ok('pregunta al /health del procesador', HEALTH.includes('`${url}/health`'))
  ok('y prueba la clave, que /health no pide', HEALTH.includes('`${url}/images?limit=1`') && HEALTH.includes("'X-API-Key': key"))
  ok('distingue configuración', /available: false, reason: 'setup'/.test(HEALTH))
  ok('de caída', /available: false, reason: 'outage'/.test(HEALTH))
  ok('no se cachea en el navegador', HEALTH.includes("'Cache-Control': 'no-store'"))
  ok('registra el fallo', /recordProviderEvent\(\{ provider: 'image_processor', operation: 'health', ok: false/.test(HEALTH))
  ok('el cliente la consulta', /export async function checkScanService\(\): Promise<boolean>/.test(BREW_DATA) && BREW_DATA.includes("fetch('/api/tbt-image/health'"))
}

// ---- (c) Brew no abre el flujo con el procesador caído
{
  const cancel = WIZARD.indexOf("status === 'cancel'")
  const check = WIZARD.indexOf('if (!(await checkScanService())) {')
  const gate = WIZARD.indexOf("setStep('gate')")
  const chooser = WIZARD.indexOf("setStep('chooser')")
  ok('comprueba antes de abrir el flujo', check > -1 && check < gate && check < chooser)
  ok('pero no bloquea el regreso de un pago ya hecho', cancel > -1 && cancel < check, 'quien vuelve de Stripe ya pagó: su registro sigue')
  ok('en su lugar muestra la pausa', /if \(!\(await checkScanService\(\)\)\) \{\s*setStep\('paused'\)/.test(WIZARD))
  ok('la pausa dice por qué', /step === 'paused'[\s\S]{0,900}t\.brew\.scanPausedNotice/.test(WIZARD))
}

// ---- (d) a mitad del flujo: avisar y cerrar, antes de crear nada
{
  ok('Cold Brew: no disponible cierra con el aviso', /if \(result\.status === 'unavailable'\) \{\s*setStep\('pausedMidBrew'\)/.test(WIZARD))
  ok('la pantalla dice lo que pasó', /step === 'pausedMidBrew'[\s\S]{0,900}t\.brew\.scanPausedMidBrew/.test(WIZARD))
  ok('Cold Brew: sin sesión pide autenticar, no pausa', /if \(result\.status === 'unauthenticated'\) \{[\s\S]{0,200}openAuth\(/.test(WIZARD))
  ok('Espresso: no disponible sale del flujo', /if \(r\.status === 'unavailable'\) \{\s*onScanUnavailable\(\)/.test(ESPRESSO))
  ok('Espresso: sin sesión pide autenticar', /if \(r\.status === 'unauthenticated'\) \{[\s\S]{0,200}openAuth\(/.test(ESPRESSO))
  ok('el asistente conecta la salida de Espresso a la pausa', /onScanUnavailable=\{\(\) => setStep\('pausedMidBrew'\)\}/.test(WIZARD))
  const scan = WIZARD.indexOf('async function runScan(')
  const draft = WIZARD.indexOf('await createDraftWork(')
  ok('el escaneo va antes de crear el borrador', scan > -1 && draft > scan, 'si no, pausar dejaría un borrador a medias')
}

// ---- (c, e) el inicio avisa y se entera solo cuando vuelve
{
  ok('consulta el estado', HOME.includes('checkScanService()'))
  ok('vuelve a preguntar al recuperar el foco', HOME.includes("window.addEventListener('focus'"))
  ok('y cada cierto tiempo', /setInterval\(/.test(HOME))
  ok('muestra el aviso', /scanPaused && \([\s\S]{0,400}t\.brew\.scanPausedNotice/.test(HOME))
  ok('la caja de Brew no abre el flujo en pausa', HOME.includes("if (b.key === 'brew' && scanPaused) e.preventDefault()"))
}

// ---- (g) la página de la obra no afirma lo que no existe
{
  ok('no dice «Protection scan passed»', !INFO.includes('t.info.scanPassed'))
  ok('ni su detalle', !INFO.includes('t.info.scanDetail'))
  ok('ni muestra una huella inventada', !INFO.includes('t.info.imageFingerprint'))
  ok('Escaneado solo con un escaneo guardado', /scannedAt && \([\s\S]{0,700}t\.info\.scanned/.test(INFO))
  ok('y con su fecha, no la de certificación', /t\.info\.scanned\}? v=\{new Date\(scannedAt\)/.test(INFO) || /k=\{t\.info\.scanned\} v=\{new Date\(scannedAt\)/.test(INFO))
}

// ---- textos, tal cual el companion 1.14
{
  const EXPECTED: Record<string, { notice: string; mid: string }> = {
    en: {
      notice: 'Registration is paused while our originality check is unavailable. Everything else works as usual.',
      mid: 'We couldn’t check originality just now, so registration is paused. Please come back a little later.',
    },
    es: {
      notice: 'El registro está en pausa mientras nuestra verificación de originalidad no está disponible. Todo lo demás funciona con normalidad.',
      mid: 'No pudimos verificar la originalidad en este momento, así que el registro está en pausa. Vuelve un poco más tarde.',
    },
    pt: {
      notice: 'O registro está pausado enquanto nossa verificação de originalidade está indisponível. Todo o resto funciona normalmente.',
      mid: 'Não conseguimos verificar a originalidade agora, por isso o registro está pausado. Volte um pouco mais tarde.',
    },
    fr: {
      notice: 'L’enregistrement est suspendu tant que notre vérification d’originalité est indisponible. Tout le reste fonctionne normalement.',
      mid: 'Nous n’avons pas pu vérifier l’originalité pour le moment, l’enregistrement est donc suspendu. Revenez un peu plus tard.',
    },
  }
  const LOCALES = Object.keys(EXPECTED)
  for (let i = 0; i < LOCALES.length; i++) {
    const l = LOCALES[i]
    const brew = JSON.parse(read(`src/i18n/messages/${l}.json`)).brew
    ok(`${l}: brew.scanPausedNotice es el texto del companion`, brew.scanPausedNotice === EXPECTED[l].notice)
    ok(`${l}: brew.scanPausedMidBrew es el texto del companion`, brew.scanPausedMidBrew === EXPECTED[l].mid)
  }
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
