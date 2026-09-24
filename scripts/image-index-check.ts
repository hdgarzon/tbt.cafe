import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Indexar tras certificar deja constancia — Update Package 01, N10.
 *
 * El indice de originalidad nunca guardo nada y nadie se entero. `complete-tbt`
 * mandaba la imagen con un `fetch` sin esperar, a una ruta propia que respondia
 * 200 aunque el procesador la rechazara, y el fallo acababa en una linea de log
 * que caduca. En serverless, ademas, lo que no se espera puede cortarse al
 * responder.
 *
 * Con la 049 y la opcion C, el indice vive en Supabase (`image_vectors`) y el
 * procesador solo devuelve un vector. Esta guarda sostiene lo que corresponde
 * de este lado:
 *  - se indexa en `after()`, que corre despues de responder y el despliegue espera;
 *  - los bytes se traen una vez, con la misma guarda de origen de publish-image;
 *  - la sha256 se calcula en el servidor y se escribe sobre works.image_sha256;
 *  - el vector se sube a image_vectors via admin client, con upsert por work_id;
 *  - el procesador se llama en /embed y se valida la forma de la respuesta;
 *  - cada desenlace queda en provider_events, el que salio bien y el que no;
 *  - un fallo abre un ticket de sistema sobre la obra;
 *  - la ruta intermedia que devolvia 200 ante cualquier cosa no existe.
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
  'la ruta que respondia 200 ante un rechazo no existe',
  !existsSync(join(root, 'src/app/api/tbt-image/register/route.ts')),
  'era un endpoint con sesion que podia alimentar el indice y ocultaba cada fallo',
)

// ---- image-index
{
  const src = code(readIf('src/lib/image-index.ts'))

  ok('existe indexCertifiedImage', /export async function indexCertifiedImage\(/.test(src))
  ok('lee la URL dentro de la funcion, no al importar', /function indexCertifiedImage[\s\S]*process\.env\.TBT_IMAGE_PROCESSOR_URL/.test(src))
  ok('trae los bytes con la guarda de origen compartida', src.includes("fetchStoredImageBytes(params.mediaUrl)"))
  ok('importa el helper de bytes', /from '@\/lib\/image-bytes'/.test(src))
  ok('calcula la sha256 en el servidor', src.includes("computeImageSha256Hex(bytes)"))
  ok('llama al procesador en /embed', /fetch\(`\$\{url\}\/embed`/.test(src))
  ok('ya no llama al viejo /images del procesador', !/`\$\{url\}\/images`/.test(src))
  ok('manda la clave del procesador', src.includes("'X-API-Key': key"))

  ok('valida que la respuesta trae 768 numeros', /payload\.embedding[\s\S]{0,120}length !== EXPECTED_EMBEDDING_DIM/.test(src))
  ok('valida el dim declarado', /payload\.dim !== EXPECTED_EMBEDDING_DIM/.test(src))
  ok('valida el modelo esperado', /payload\.model[\s\S]{0,120}startsWith\(EXPECTED_MODEL_PREFIX\)/.test(src))

  ok('sube el vector a image_vectors por upsert', /from\('image_vectors'\)[\s\S]{0,200}\.upsert\(\{[\s\S]{0,200}onConflict: 'work_id'/.test(src))
  ok('escribe la sha256 sobre works.image_sha256', /from\('works'\)[\s\S]{0,200}\.update\(\{ image_sha256: imageSha256/.test(src))
  ok('escribe la sha256 despues del vector', src.indexOf(".from('image_vectors')") > -1 && src.indexOf(".from('image_vectors')") < src.indexOf(".from('works')"), 'un filtro exacto vivo con el indice vacio es peor que no tenerlo')

  ok('registra el exito', /recordProviderEvent\(\{[^}]*ok: true/.test(src))
  ok('registra el fallo', /recordProviderEvent\(\{[^}]*ok: false/.test(src))
  ok('siempre como image_processor / index_image', count(src, "provider: 'image_processor'") === count(src, 'recordProviderEvent(') && count(src, "operation: 'index_image'") === count(src, 'recordProviderEvent('))
  ok('siempre sobre la obra', count(src, "entityType: 'work'") >= count(src, 'recordProviderEvent('))

  ok('un fallo abre un ticket de sistema', src.includes("eventCode: 'image_index_failed'"))
  ok('el ticket es sobre la obra y su creador', /fileSystemTicket\([^)]*\{[\s\S]{0,200}userId: params\.creatorId,[\s\S]{0,120}entityType: 'work',[\s\S]{0,80}entityId: params\.workId/.test(src))
  ok('sin URL configurada tambien es un fallo, no un silencio', /if \(!url\) \{[\s\S]{0,400}return fail\(/.test(src))
  ok('una respuesta no-ok del procesador es un fallo', /if \(!response\.ok\) \{?[\s\S]{0,300}return fail\(/.test(src))
  ok('un upsert fallido de image_vectors es un fallo', /image_vectors_upsert_failed/.test(src))
  ok('un update fallido de image_sha256 es un fallo', /works_image_sha256_write_failed/.test(src))
  ok('nunca lanza', /export async function indexCertifiedImage[\s\S]*try \{[\s\S]*\} catch \(error\) \{[\s\S]*return fail\(/.test(src))
}

// ---- el ticket
{
  const src = read('src/lib/system-tickets.ts')
  ok('image_index_failed es un codigo de evento', /SystemEventCode =[\s\S]{0,300}\| 'image_index_failed'/.test(src))
  const at = src.indexOf('image_index_failed: {')
  const block = at > -1 ? src.slice(at, at + 2600) : ''
  ok('tiene plantilla', at > -1)
  ok('en los cuatro idiomas', /en: \{/.test(block) && /es: \{/.test(block) && /pt: \{/.test(block) && /fr: \{/.test(block))
  ok('no habla de certificados', !/certific/i.test(block))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
