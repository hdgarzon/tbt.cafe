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
//
// Update Package 01, N9 y N10 opcion C. El procesador devuelve el vector; la
// busqueda contra el corpus se hace en `image_vectors` (Supabase), no en el
// disco del procesador. Esa separacion es la que hace que un redespliegue no
// vacie el indice — el fallo original de N10.
{
  ok('lee la configuración al atender, no al importar', /export async function POST[\s\S]*process\.env\.TBT_IMAGE_PROCESSOR_URL/.test(SIMILARITY))
  ok('sin URL: configuración', /if \(!url\) return unavailable\('setup', 'url_unset'\)/.test(SIMILARITY))
  ok('sin clave: configuración', /if \(!key\) return unavailable\('setup', 'key_missing'\)/.test(SIMILARITY))
  ok('clave rechazada: configuración', /embedResponse\.status === 401 \|\| embedResponse\.status === 403\) return unavailable\('setup', 'key_rejected'\)/.test(SIMILARITY))
  ok('otra respuesta no-ok: caída', /if \(!embedResponse\.ok\) return unavailable\('outage', `http_\$\{embedResponse\.status\}`\)/.test(SIMILARITY))
  ok('una excepción: caída', /catch \(error\) \{\s*return unavailable\('outage', 'unreachable', error\)/.test(SIMILARITY))
  ok('no disponible responde 503', SIMILARITY.includes("NextResponse.json({ status: 'unavailable', reason }, { status: 503 })"))
  ok('el fallo queda en provider_events', /recordProviderEvent\(\{ provider: 'image_processor', operation: 'search_images', ok: false/.test(SIMILARITY))
  ok('y el escaneo que sí corrió también', /recordProviderEvent\(\{ provider: 'image_processor', operation: 'search_images', ok: true/.test(SIMILARITY))
  ok('pide el vector al procesador en /embed', /fetch\(`\$\{url\}\/embed`/.test(SIMILARITY))
  ok('valida la dimensión declarada', /payload\.dim !== EXPECTED_EMBEDDING_DIM/.test(SIMILARITY))
  ok('pero compara contra image_vectors, no contra el procesador', /from\('image_vectors'\)/.test(SIMILARITY),
     'el indice vive en Supabase: un redespliegue del procesador no lo vacia')
  ok('guarda el escaneo en plagiarism_scans', /from\('plagiarism_scans'\)/.test(SIMILARITY))
}

// ---- (a) el escaneo se guarda de verdad, y llega a la obra — §6 "Scan stored"
//
// persistScan escribia `user_id`, `status`, `top_score` y `matches` en una
// tabla que no tenia tres de esas columnas y exigia `work_id`. supabase-js
// devuelve el error en vez de lanzarlo, el try/catch no lo vio, y la tabla
// quedo vacia mientras la interfaz decia que el escaneo se guardaba.
{
  const COMPLETE = code(read('src/app/api/complete-tbt/route.ts'))
  const WORK_PAGE = code(read('src/app/work/[tbtId]/page.tsx'))
  const WORK_CLIENT = code(read('src/app/work/[tbtId]/WorkClient.tsx'))
  const M052 = readIf('supabase/migrations/052_plagiarism_scans_writer.sql')

  // Las columnas que existen: el esquema base (schema-snapshot) mas la 052.
  const COLUMNS = ['id', 'work_id', 'scan_result', 'similarity_score', 'flagged_items', 'is_original', 'scanned_at', 'user_id']
  const insert = SIMILARITY.match(/from\('plagiarism_scans'\)\s*\.insert\(\{([\s\S]*?)\}\)/)
  const keys = insert ? Array.from(insert[1].matchAll(/^\s*([a-z_]+)\s*(?::|,|$)/gm), (m) => m[1]) : []
  ok('persistScan inserta en plagiarism_scans', keys.length > 0)
  const unknown = keys.filter((k) => COLUMNS.indexOf(k) === -1)
  ok('y solo en columnas que existen', unknown.length === 0, `desconocidas: ${unknown.join(', ')}`)
  ok('lee el error que supabase-js devuelve, no espera una excepción', /const \{ data, error \} = await admin\s*\.from\('plagiarism_scans'\)/.test(SIMILARITY))
  ok('un fallo al guardar queda en provider_events', /operation: 'persist_scan', ok: false/.test(SIMILARITY))
  ok('la respuesta lleva el id del escaneo', (SIMILARITY.match(/scanId \}\)/g) ?? []).length === 3)

  ok('la 052 deja work_id opcional', /alter column work_id drop not null/.test(M052), 'el escaneo corre antes de que exista la obra')
  ok('y añade user_id y works.plagiarism_scan_id', /add column if not exists user_id/.test(M052) && /add column if not exists plagiarism_scan_id/.test(M052))
  ok('la 052 no abre politicas en plagiarism_scans', !/create policy/i.test(M052))

  ok('Cold Brew guarda el id que devolvió el escaneo', WIZARD.includes('setScanId(result.scanId ?? null)'))
  ok('un escaneo nuevo olvida el anterior', /setScanState\('scanning'\)\s*setScanId\(null\)/.test(WIZARD))
  ok('Espresso lo entrega al asistente', ESPRESSO.includes('setScanId(r.scanId ?? null)') && WIZARD.includes('setScanId(r.scanId)'))
  ok('el borrador lo guarda', BREW_DATA.includes('plagiarism_scan_id: input.scanId'))

  ok('complete-tbt enlaza el escaneo a la obra', /from\('plagiarism_scans'\)\s*\.update\(\{ work_id: workId \}\)/.test(COMPLETE))
  ok('solo si es del mismo creador', /\.eq\('id', work\.plagiarism_scan_id\)\s*\.eq\('user_id', user\.id\)/.test(COMPLETE))
  ok('y no estaba enlazado a otra obra', /\.eq\('user_id', user\.id\)\s*\.is\('work_id', null\)/.test(COMPLETE))

  ok('la página de la obra lee la fecha en el servidor', /from\('plagiarism_scans'\)\s*\.select\('scanned_at'\)/.test(WORK_PAGE))
  ok('solo para una obra visible sin sesión', /const \{ data: visible \} = await publicClient\(\)/.test(WORK_PAGE))
  ok('y la pasa a la pestaña Info', WORK_CLIENT.includes('<InfoTab work={work} scannedAt={scannedAt} />'))
}

// ---- (c, e) comprobación previa: /health
{
  ok('existe la ruta de estado', HEALTH.length > 0)
  ok('no pide sesión: el aviso lo ve cualquiera en el inicio', !HEALTH.includes('authenticate('))
  ok('es dinámica', HEALTH.includes("export const dynamic = 'force-dynamic'"))
  ok('pregunta al /health del procesador', HEALTH.includes('`${url}/health`'))
  ok('y prueba la clave, que /health no pide', HEALTH.includes('`${url}/embed`') && HEALTH.includes("'X-API-Key': key"))
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
