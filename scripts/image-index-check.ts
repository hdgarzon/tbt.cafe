import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Indexar tras certificar deja constancia — Update Package 01, N10 (b).
 *
 * El índice de originalidad nunca guardó nada y nadie se enteró. `complete-tbt`
 * mandaba la imagen con un `fetch` sin esperar, a una ruta propia que respondía
 * 200 aunque el procesador la rechazara, y el fallo acababa en una línea de log
 * que caduca. En serverless, además, lo que no se espera puede cortarse al
 * responder.
 *
 * Esta guarda sostiene lo contrario:
 *  - se indexa en `after()`, que corre después de responder y el despliegue espera;
 *  - cada desenlace queda en `provider_events`, el que salió bien y el que no;
 *  - un fallo abre un ticket de sistema sobre la obra;
 *  - la ruta intermedia que devolvía 200 ante cualquier cosa ya no existe.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const count = (s: string, needle: string) => s.split(needle).length - 1

// ---- complete-tbt
{
  const src = code(read('src/app/api/complete-tbt/route.ts'))

  ok('importa after de next/server', /import \{[^}]*\bafter\b[^}]*\} from 'next\/server'/.test(src))
  ok('indexa dentro de after()', /after\(\s*\(\)\s*=>\s*indexCertifiedImage\(\{/.test(src), 'sin after, serverless puede cortar lo que no se espera')
  ok('ya no llama a la ruta intermedia', !src.includes('/api/tbt-image/register'))
  ok('ya no traga el fallo en un console.warn', !src.includes(".catch((err) => console.warn('[tbt-image/register]"))
}

// ---- la ruta intermedia
ok(
  'la ruta que respondía 200 ante un rechazo no existe',
  !existsSync(join(root, 'src/app/api/tbt-image/register/route.ts')),
  'era un endpoint con sesión que podía alimentar el índice y ocultaba cada fallo'
)

// ---- image-index
{
  const src = code(readIf('src/lib/image-index.ts'))

  ok('existe indexCertifiedImage', /export async function indexCertifiedImage\(/.test(src))
  ok('lee la URL dentro de la función, no al importar', /function indexCertifiedImage[\s\S]*process\.env\.TBT_IMAGE_PROCESSOR_URL/.test(src))
  ok('comprueba el origen antes de pedir la imagen', src.indexOf('assertPublishableSource(') > -1 && src.indexOf('assertPublishableSource(') < src.indexOf('fetch(params.mediaUrl'))
  ok('manda la clave del procesador', src.includes("'X-API-Key': key"))

  ok('registra el éxito', /recordProviderEvent\(\{[^}]*ok: true/.test(src))
  ok('registra el fallo', /recordProviderEvent\(\{[^}]*ok: false/.test(src))
  ok('siempre como image_processor / index_image', count(src, "provider: 'image_processor'") === count(src, 'recordProviderEvent(') && count(src, "operation: 'index_image'") === count(src, 'recordProviderEvent('))
  ok('siempre sobre la obra', count(src, "entityType: 'work'") >= count(src, 'recordProviderEvent('))

  ok('un fallo abre un ticket de sistema', src.includes("eventCode: 'image_index_failed'"))
  ok('el ticket es sobre la obra y su creador', /fileSystemTicket\([^)]*\{[\s\S]{0,200}userId: params\.creatorId,[\s\S]{0,120}entityType: 'work',[\s\S]{0,80}entityId: params\.workId/.test(src))
  ok('sin URL configurada también es un fallo, no un silencio', /if \(!url\) \{[\s\S]{0,400}return fail\(/.test(src))
  ok('una respuesta no-ok del procesador es un fallo', /if \(!response\.ok\) \{?[\s\S]{0,300}return fail\(/.test(src))
  ok('nunca lanza', /export async function indexCertifiedImage[\s\S]*try \{[\s\S]*\} catch \(error\) \{[\s\S]*return fail\(/.test(src))
}

// ---- el ticket
{
  const src = read('src/lib/system-tickets.ts')
  ok('image_index_failed es un código de evento', /SystemEventCode =[\s\S]{0,300}\| 'image_index_failed'/.test(src))
  const at = src.indexOf('image_index_failed: {')
  const block = at > -1 ? src.slice(at, at + 2600) : ''
  ok('tiene plantilla', at > -1)
  ok('en los cuatro idiomas', /en: \{/.test(block) && /es: \{/.test(block) && /pt: \{/.test(block) && /fr: \{/.test(block))
  ok('no habla de certificados', !/certific/i.test(block))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
