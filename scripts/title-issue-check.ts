import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Emitir y entregar un título — Work Order 01 Stage 5, a Title Specification 02.
 *
 * Esta guarda sostiene:
 *  - el título lo emite el servidor; el navegador ya no puede insertar uno;
 *  - lo que el título imprime queda congelado en la fila, para re-renderizarlo
 *    byte a byte cuando haga falta (§4 a);
 *  - la firma que se imprime es la congelada en la obra, nunca la del perfil
 *    (§5 c, f), y no aparece en un título bonded (§5 d);
 *  - un reintento de registro o de transferencia no emite dos títulos;
 *  - la página del enlace abre solo para el titular de ese título, durante 30
 *    días, sin token en la URL, con los archivos en un bucket privado.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
const sql = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const M055 = sql('supabase/migrations/055_title_issue.sql')
const ISSUE = code(read('src/lib/titles/issue.ts'))
const TBT = code(read('src/app/api/complete-tbt/route.ts'))
const TRANSFER = code(read('src/app/api/complete-transfer/route.ts'))
const LINK = code(read('src/app/api/titles/[number]/route.ts'))

// ---- el servidor emite
{
  ok('la 055 cierra la inserción desde el cliente', M055.includes('drop policy if exists "Creador o dueño puede emitir titulos" on public.titles'))
  ok('los archivos viven en una tabla solo del servidor', /alter table public\.title_files enable row level security/.test(M055) && /revoke all on public\.title_files from anon, authenticated/.test(M055))
  ok('la 055 no abre políticas', !/create policy/i.test(M055))
  ok('el bucket es privado', /values \('titles', 'titles', false\)/.test(M055))
  // titles es legible por cualquiera; facts lleva la firma y la línea del titular.
  ok('la lectura pública de titles se retira entera', /revoke select on public\.titles from anon, authenticated;/.test(M055))
  const grant = (M055.match(/grant select \(([^)]*)\)\s*on public\.titles to anon, authenticated;/) ?? [])[1] ?? ''
  ok('y se devuelve columna por columna', grant.length > 0)
  ok('sin facts ni source_key', grant.length > 0 && !/\bfacts\b/.test(grant) && !/\bsource_key\b/.test(grant))
  ok('complete-tbt ya no inserta el título por su cuenta', !/\.from\('titles'\)\s*\.insert\(/.test(TBT))
  ok('complete-transfer tampoco', !/\.from\('titles'\)\s*\.insert\(/.test(TRANSFER))
}

// ---- una emisión por hecho
{
  ok('la clave del hecho es única', /create unique index if not exists titles_source_key_key/.test(M055))
  ok('el registro emite con su clave', TBT.includes('sourceKey: `registration:${workId}`'))
  ok('la transferencia emite con la suya', TRANSFER.includes('sourceKey: `transfer:${transfer.id}`'))
  ok('un reintento encuentra la fila', /\.eq\('source_key', input\.sourceKey\)/.test(ISSUE))
  ok('y una carrera perdida lee la del ganador', ISSUE.includes("error?.code === '23505'"))
  ok('en after(): el titular no espera al render', /after\(\(\) =>\s*issueTitle\(/.test(TBT) && /after\(\(\) =>\s*issueTitle\(/.test(TRANSFER))
}

// ---- congelado y re-renderizable (§4 a)
{
  ok('la fila guarda lo que el título imprime', /facts,\n/.test(ISSUE) && M055.includes('add column if not exists facts jsonb'))
  ok('el render sale de la fila, no de la obra viva', ISSUE.includes('render(title.facts as TitleFacts, work.media_url)'))
  ok('la versión y supersedes salen del título anterior', ISSUE.includes('version: (previous?.version ?? 0) + 1') && ISSUE.includes('supersedes: previous?.id ?? null'))
  ok('el enlace dura 30 días desde la emisión', ISSUE.includes('export const TITLE_LINK_DAYS = 30') && ISSUE.includes('TITLE_LINK_DAYS * 86_400_000'))
  ok('el renderer se lee al llamar, no al importar', /async function render\([\s\S]*process\.env\.TBT_TITLE_RENDERER_URL/.test(ISSUE))
}

// ---- la firma (§5)
{
  ok('se imprime la copia de la obra', ISSUE.includes('strokes(work.signature_strokes)'))
  ok('nunca la del perfil', !/signature:[^\n]*profile/.test(ISSUE))
  ok('ausente en bonded', ISSUE.includes('signature: bonded ? [] : strokes(work.signature_strokes)'))
  ok('se congela al certificar, sin pisar una existente', /\.update\(\{ signature_strokes: signer\.signature_strokes \}\)\s*\.eq\('id', workId\)\s*\.is\('signature_strokes', null\)/.test(TBT))
}

// ---- la página del enlace (Step 17)
{
  ok('pide sesión', LINK.includes('const auth = await authenticate(request)'))
  ok('solo el titular de ese título', /\.eq\('title_number', number\)\s*\.eq\('owner_id', auth\.user\.id\)/.test(LINK))
  ok('un título ajeno responde como uno inexistente', LINK.includes("NextResponse.json({ error: 'not_found' }, { status: 404 })"))
  ok('cerrado pasados los 30 días', LINK.includes("status: 'expired' }, { status: 410 })"))
  ok('URLs firmadas de vida corta', /createSignedUrl\(files\.gif_path, SIGNED_URL_SECONDS/.test(LINK) && /const SIGNED_URL_SECONDS = 600/.test(LINK))
  const locales = ['en', 'es', 'pt', 'fr']
  const keys = Object.keys(JSON.parse(read('src/i18n/messages/en.json')).titleLink ?? {}).sort().join(',')
  for (let i = 0; i < locales.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${locales[i]}.json`))
    ok(`${locales[i]}: titleLink tiene las mismas claves`, Object.keys(m.titleLink ?? {}).sort().join(',') === keys && keys.length > 0)
  }
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
