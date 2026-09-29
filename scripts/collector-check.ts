import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * El registro por coleccionista — Work Order 01 Step 20, con las correcciones de
 * Update Package 01 §2 y la nota del 11+ Addendum sobre la lista de supresión.
 *
 * Esta guarda sostiene, por partes, lo que ya está construido:
 *  - un reclamo es un ticket HR-#### de la categoría `claim`, no CLM-#### ni
 *    claims@tbt.cafe (el dominio no recibe correo), y lleva el resultado del
 *    escaneo y la obra con la que coincidió, leídos en el servidor;
 *  - lo que el coleccionista declara del creador se separa en lo público y lo
 *    privado: el contacto de un tercero, el precio pagado y el documento de
 *    procedencia no salen nunca del servidor;
 *  - de un creador vivo solo se guarda ciudad y país, nunca una dirección;
 *  - la lista de supresión existe a la vez que el campo de contacto.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
const sql = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const M = sql('supabase/migrations/057_collector_registration.sql')
const CLAIM = code(read('src/app/api/claims/route.ts'))
const WIZARD = code(read('src/components/brew/BrewWizard.tsx'))

// ---- el reclamo
{
  ok('la categoría claim existe', /tickets_category_check[\s\S]*'claim'/.test(M))
  ok('el reclamo es un ticket', /from\('tickets'\)\s*\.insert\(/.test(CLAIM) && CLAIM.includes("category: 'claim'"))
  ok('no hay CLM- ni claims@', !/CLM-/.test(CLAIM + WIZARD) && !/claims@tbt\.cafe/.test(CLAIM + WIZARD))
  ok('el escaneo se lee en el servidor, no se cree al navegador', /from\('plagiarism_scans'\)[\s\S]*\.eq\('user_id', auth\.user\.id\)/.test(CLAIM))
  ok('solo un escaneo bloqueado abre un reclamo', CLAIM.includes("scanStatus !== 'blocked'"))
  ok('el ticket lleva el escaneo y la obra con la que coincidió', CLAIM.includes('scan_id: scan.id') && CLAIM.includes('matched_work_id: matched.id') && CLAIM.includes('score:'))
  const FORM = code(read('src/components/brew/ClaimForm.tsx'))
  ok('Brew ofrece el reclamo al bloquear', WIZARD.includes("{scanState === 'blocked' && <ClaimForm scanId={scanId} />}"))
  ok('el formulario abre el ticket por la ruta del servidor', FORM.includes("fetch('/api/claims'") && FORM.includes('t.claim.file'))
}

// ---- lo público y lo privado del creador declarado
{
  ok('el registro como coleccionista se marca en la obra', /add column if not exists registered_as text/.test(M))
  ok('lo público del creador declarado tiene su tabla', /create table if not exists public\.bonded_creators/.test(M))
  ok('lo privado, otra, solo del servidor', /create table if not exists public\.bonded_private/.test(M) &&
     /alter table public\.bonded_private enable row level security/.test(M) &&
     /revoke all on public\.bonded_private from anon, authenticated/.test(M))
  const pub = (M.match(/create table if not exists public\.bonded_creators \(([\s\S]*?)\n\);/) ?? [])[1] ?? ''
  ok('la tabla pública no tiene contacto, precio ni documento', pub.length > 0 && !/contact|price|doc_|provenance|address/.test(pub))
  ok('ni dirección: de un creador vivo, ciudad y país', /\bcity text\b/.test(pub) && !/street|address/.test(pub))
  ok('la tabla pública solo se lee de obras certificadas', /on public\.bonded_creators for select[\s\S]*status = 'certified'/.test(M))
  ok('y nadie la escribe desde el navegador', !/on public\.bonded_creators for (insert|update|all)/.test(M) &&
     /revoke insert, update, delete on public\.bonded_creators from anon, authenticated/.test(M))
}

// ---- la lista de supresión
{
  ok('existe la lista de supresión', /create table if not exists public\.contact_suppressions/.test(M))
  ok('guarda el hash del contacto, no el contacto', /contact_hash text primary key/.test(M) && !/contact text/.test((M.match(/create table if not exists public\.contact_suppressions \(([\s\S]*?)\n\);/) ?? [])[1] ?? ''))
  ok('y es solo del servidor', /alter table public\.contact_suppressions enable row level security/.test(M) && /revoke all on public\.contact_suppressions from anon, authenticated/.test(M))
}

// ---- el flujo del coleccionista (prototipo v11, phase 2)
{
  const ROUTE = code(read('src/app/api/brew/bonded/route.ts'))
  const STEPS = code(read('src/components/brew/CollectorSteps.tsx'))
  const SUPP = code(read('src/lib/contact-suppression.ts'))
  const WORKDATA = code(read('src/lib/work-data.ts'))
  const CREATORS = code(read('src/lib/creator-data.ts'))
  const WCLIENT = code(read('src/app/work/[tbtId]/WorkClient.tsx'))
  ok('quién registra va antes de elegir cómo', WIZARD.includes("setStep('who')") && /if \(step === 'who'\)/.test(WIZARD))
  ok('Espresso deshabilitado para el coleccionista, con la razón', WIZARD.includes('disabled={asCollector}') && WIZARD.includes('t.collector.espressoReason'))
  ok('el coleccionista pasa por el creador y la procedencia', WIZARD.includes("setStep(asCollector ? 'creator' : 'work1')") && WIZARD.includes("onNext={() => setStep('provenance')}"))
  ok('lo declarado se guarda en el servidor antes del pago', /if \(brewAs === 'collector'\) \{\s*const saved = await saveBondedDetails\(id, bonded, bondedDoc\)/.test(WIZARD))
  ok('el sello nombra al creador declarado, no a quien registra', WIZARD.includes("brewAs === 'collector'") && WIZARD.includes('t.collector.unattributed'))
  ok('la ruta solo acepta el borrador de quien llama', ROUTE.includes('work.creator_id !== auth.user.id') && ROUTE.includes("work.status !== 'draft'"))
  ok('un contacto suprimido no se guarda', /await keepContact\(admin, c\.contact\)/.test(ROUTE) && /await keepContact\(admin, c\.estateContact\)/.test(ROUTE) &&
     SUPP.includes(".from('contact_suppressions')"))
  ok('el contacto se compara por hash', SUPP.includes('contactHash(n.value)'))
  ok('el contacto del creador solo si está vivo y se le puede contactar', ROUTE.includes("status === 'living' && c.reachable === 'yes'"))
  ok('el documento va al bucket privado y a la obra solo su hash', ROUTE.includes(".from('provenance')") && ROUTE.includes('provenance_hash: provenanceHash') && ROUTE.includes('`sha256:${hex}`'))
  ok('la pantalla no pide dirección', !/address/i.test(STEPS))
  ok('la página de la obra nombra al creador declarado', WORKDATA.includes('bonded:bonded_creators(name, unattributed, alias, city, status)') && WCLIENT.includes("work.registered_as === 'collector'"))
  ok('una obra registrada como coleccionista no aparece como propia del que la registró', CREATORS.includes(".eq('registered_as', 'creator')"))
  const locales = ['en', 'es', 'pt', 'fr']
  const keys = Object.keys(JSON.parse(read('src/i18n/messages/en.json')).collector ?? {}).sort().join(',')
  for (let i = 0; i < locales.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${locales[i]}.json`))
    ok(`${locales[i]}: collector tiene las mismas claves`, Object.keys(m.collector ?? {}).sort().join(',') === keys && keys.length > 0)
  }
  ok('"Gallery certificate" pasa a Gallery documentation', JSON.parse(read('src/i18n/messages/en.json')).collector?.docGallery === 'Gallery documentation')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
