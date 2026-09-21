import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * El indice de originalidad vive en Supabase, junto a la evidencia — Update
 * Package 01, N10 (opcion C aprobada 17 septiembre 2026).
 *
 * Esta guarda sostiene lo esencial del cambio:
 *  - la extension `vector` se habilita;
 *  - `works.image_sha256` existe, con un indice parcial para el filtro exacto;
 *  - `image_vectors` es una tabla con `vector(768)` e indice HNSW sobre coseno;
 *  - RLS activa y SIN politicas: solo entra el service role (Federico #2);
 *  - hay una comprobacion runtime que rompe la migracion si aparece una politica.
 *
 * El snapshot refleja los tres cambios: la extension, la columna sobre `works`,
 * y la tabla `image_vectors` con su indice y su RLS.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// ---- migracion 049
{
  const path = 'supabase/migrations/049_image_vectors_and_sha256.sql'
  ok(`existe ${path}`, existsSync(join(root, path)))
  const src = read(path)

  ok('habilita la extension vector', /create extension if not exists vector\b/.test(src))
  ok('anade works.image_sha256 text', /alter table public\.works[\s\S]{0,400}add column if not exists image_sha256 text/.test(src))
  ok('indexa image_sha256 solo cuando no es nulo', /works_image_sha256_idx[\s\S]{0,400}where image_sha256 is not null/.test(src))
  ok('deja un comment que aclara que atrapa byte-identicas', /comment on column public\.works\.image_sha256[\s\S]{0,800}byte-identic/.test(src))
  ok('crea la tabla image_vectors', /create table if not exists public\.image_vectors/.test(src))
  ok('work_id es clave primaria y cae con la obra', /work_id uuid primary key references public\.works\(id\) on delete cascade/.test(src))
  ok('embedding es vector(768) not null', /embedding[\s\S]{0,80}vector\(768\)\s+not null/.test(src))
  ok('crea indice HNSW cosine sobre embedding', /image_vectors_embedding_idx[\s\S]{0,400}using hnsw \(embedding [^)]*vector_cosine_ops\)/.test(src))
  ok('RLS activada sobre image_vectors', /alter table public\.image_vectors enable row level security/.test(src))
  ok('sin politicas para image_vectors', !/create policy[^;]+on public\.image_vectors/i.test(src), 'service role bypasses RLS; anon y authenticated se niegan por defecto')
  ok('comprobacion runtime rompe si aparece una politica', /pg_policies[\s\S]{0,400}image_vectors[\s\S]{0,400}raise exception/.test(src))
}

// ---- snapshot
{
  const src = read('supabase/schema-snapshot.sql')

  ok('el snapshot habilita la extension vector', /create extension if not exists vector\b/.test(src))
  ok('el snapshot lleva works.image_sha256', /image_sha256 text/.test(src))
  ok('el snapshot indexa works.image_sha256', /works_image_sha256_idx/.test(src))
  ok('el snapshot crea image_vectors', /create table if not exists public\.image_vectors/.test(src))
  ok('el snapshot embedding es vector(768)', /embedding[\s\S]{0,80}vector\(768\)/.test(src))
  ok('el snapshot indexa embedding con HNSW cosine', /image_vectors_embedding_idx[\s\S]{0,400}vector_cosine_ops/.test(src))
  ok('el snapshot activa RLS en image_vectors', /alter table (only )?public\.image_vectors enable row level security/.test(src))
  ok('el snapshot no declara politicas para image_vectors', !/create policy[^;]+on public\.image_vectors/i.test(src))
}

// ---- image-dedup: el filtro exacto
{
  const path = 'src/lib/image-dedup.ts'
  ok(`existe ${path}`, existsSync(join(root, path)))
  const src = read(path)

  ok('exporta findExactDuplicateByAnotherCreator', /export async function findExactDuplicateByAnotherCreator\(/.test(src))
  ok('consulta image_sha256 sobre works', /\.from\('works'\)[\s\S]{0,400}\.eq\('image_sha256'/.test(src))
  ok('excluye al propio creador', /\.neq\('creator_id'/.test(src))
  ok('solo cuenta obras certificadas', /\.eq\('status', 'certified'\)/.test(src))
  ok('un draft ajeno no bloquea', src.includes("'certified'") && !/'draft'/.test(src), 'bloquear por drafts ajenos volveria abusable el sistema')
}

// ---- image-bytes: los dos helpers
{
  const path = 'src/lib/image-bytes.ts'
  ok(`existe ${path}`, existsSync(join(root, path)))
  const src = read(path)

  ok('exporta fetchStoredImageBytes', /export async function fetchStoredImageBytes\(/.test(src))
  ok('exporta computeImageSha256Hex', /export function computeImageSha256Hex\(/.test(src))
  ok('fetchStoredImageBytes usa la guarda de origen', src.includes('assertPublishableSource('))
  ok('computeImageSha256Hex devuelve hex sin prefijo', /createHash\('sha256'\)[\s\S]{0,200}\.digest\('hex'\)/.test(src) && !/'sha256:'/.test(src))
}

// ---- create-checkout: el filtro corre antes de la sesion de Stripe
{
  const path = 'src/app/api/stripe/create-checkout/route.ts'
  const src = read(path)

  ok(`importa el filtro en ${path}`, /findExactDuplicateByAnotherCreator/.test(src))
  ok('trae los bytes desde storage', /fetchStoredImageBytes\(/.test(src))
  ok('calcula la sha256 en el servidor', /computeImageSha256Hex\(/.test(src))
  ok('lee media_url del select de la obra', /\.select\('id, creator_id, context_data, media_url'\)/.test(src))
  ok('devuelve image_duplicate con 409', /error: 'image_duplicate'[\s\S]{0,200}status: 409/.test(src))
  ok('el filtro corre antes de createCheckoutSession', src.indexOf('findExactDuplicateByAnotherCreator(') > -1 && src.indexOf('findExactDuplicateByAnotherCreator(') < src.indexOf('createCheckoutSession('), 'bloquear despues costaria un reembolso')
  ok('un fallo del filtro no cobra', /error: 'dedup_check_failed'[\s\S]{0,200}status: 503/.test(src))
}

// ---- copia i18n en los cuatro idiomas
for (const lang of ['en', 'es', 'pt', 'fr'] as const) {
  const src = read(`src/i18n/messages/${lang}.json`)
  ok(`${lang}: brew.imageAlreadyRegistered existe`, /"imageAlreadyRegistered"\s*:\s*"[^"]+"/.test(src))
  ok(`${lang}: menciona otro creador`, /"imageAlreadyRegistered"\s*:\s*"[^"]*(otro creador|another creator|outro criador|autre créateur)[^"]*"/i.test(src))
}

// ---- image-index-health: el conteo comparado
{
  const path = 'src/lib/image-index-health.ts'
  ok(`existe ${path}`, existsSync(join(root, path)))
  const src = read(path)

  ok('exporta getImageIndexHealth', /export async function getImageIndexHealth\(/.test(src))
  ok('cuenta obras certificadas con media', /from\('works'\)[\s\S]{0,400}\.eq\('status', 'certified'\)[\s\S]{0,200}\.not\('media_url', 'is', null\)/.test(src))
  ok('cuenta image_vectors', /from\('image_vectors'\)[\s\S]{0,200}count: 'exact'/.test(src))
  ok('devuelve divergent como booleano', /divergent:\s*certifiedCount\s*!==\s*indexedCount/.test(src))
  ok('lista las que faltan, con techo', /MISSING_LIST_LIMIT/.test(src) && /\.limit\(MISSING_LIST_LIMIT\)/.test(src))
}

// ---- observability expone imageIndex
{
  const src = read('src/app/api/admin/observability/route.ts')
  ok('importa getImageIndexHealth', /getImageIndexHealth/.test(src))
  ok('lo llama en el Promise.all', /getImageIndexHealth\(supabase\)/.test(src))
  ok('lo devuelve como imageIndex', /imageIndex,/.test(src))
}

// ---- reindex script
{
  const path = 'scripts/reindex-images.ts'
  ok(`existe ${path}`, existsSync(join(root, path)))
  const src = read(path)

  ok('lee certificadas con media', /\.eq\('status', 'certified'\)[\s\S]{0,200}\.not\('media_url', 'is', null\)/.test(src))
  ok('reusa indexCertifiedImage', /indexCertifiedImage\(\{/.test(src))
  ok('rechaza correr sin HF_TOKEN', /if \(!process\.env\.HF_TOKEN\)[\s\S]{0,300}return 1/.test(src))
}

// ---- npm script
{
  const src = read('package.json')
  ok('npm run reindex:images esta declarado', /"reindex:images":\s*"[^"]*reindex-images\.ts/.test(src))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
