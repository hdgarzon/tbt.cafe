import { readFileSync } from 'fs'
import { join } from 'path'
import { amendRecord, amendmentDiff, MINOR_FIELDS } from '../src/lib/chain/amend'
import { canonicalize, recordHash, RECORD_SCHEMA } from '../src/lib/chain/serialize'
import { assertNoIdentifiers, pseudonymFor } from '../src/lib/chain/pseudonym'
import { HIGH_RISK } from '../src/lib/admin/guard'

/**
 * Un registro no se edita nunca — Item 5. Prueba primero.
 *
 * Lo que se comprueba aqui no es que la correccion salga bien: es que NADA MAS
 * cambie. Una enmienda que arrastre un campo de mas es una reescritura
 * silenciosa publicada en un almacen que no se borra.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'no lanzó') } catch { ok(label, true) }
}

const AR = 'https://arweave.net/3Bq9original'
const A = pseudonymFor('5b84cf07-6516-4873-bfdd-379805913c4d')
const B = pseudonymFor('51272678-0000-4000-8000-000000000000')

/**
 * El registro vigente. Lleva a proposito campos que `amend.ts` NO conoce
 * —`image`, `image_hash`, `image_kind`— porque esa es la propiedad que importa:
 * un campo que se añada al registro despues tiene que sobrevivir a una enmienda
 * sin que nadie toque este archivo.
 */
const current: Record<string, unknown> = {
  schema: RECORD_SCHEMA,
  type: 'registration',
  tbt_id: 'TBT-2026-ABC123',
  sequence: 1,
  content_hash: 'sha256:' + 'a'.repeat(64),
  creator: { name: 'Sara Alarcón', id: A, type: 'individual' },
  work: { title: 'Nocturno en Medellin', year: 2025, category: 'painting', technique: 'oleo', originality: 'original' },
  context: { statement: 'Pintado de noche.', city: 'Medellin' },
  series: 'Nocturnos',
  image: 'https://arweave.net/8Kf2img',
  image_hash: 'sha256:' + 'b'.repeat(64),
  image_kind: 'thumbnail',
  sealed_at: '2026-08-26T14:03:22Z',
  issuer: 'tbt.cafe',
}

const meta = { supersedes: AR, reason: '  Título mal escrito.  ', decidedBy: { initiator: A, approver: B } }

// ---- LO ESENCIAL: lo que este archivo no conoce viaja igual
{
  const next = amendRecord(current, { title: 'Nocturno en Medellín' }, meta)

  ok('un campo que amend.ts no conoce sobrevive', next.image === 'https://arweave.net/8Kf2img',
     'si no, una enmienda borraría la imagen publicada sin que nadie lo pidiera')
  ok('y los que lo acompañan también',
     next.image_hash === current.image_hash && next.image_kind === 'thumbnail')
  ok('la corrección se aplicó', (next.work as Record<string, unknown>).title === 'Nocturno en Medellín')
  ok('y nada más de work cambió',
     (next.work as Record<string, unknown>).technique === 'oleo' &&
     (next.work as Record<string, unknown>).originality === 'original')
  ok('el original no se tocó', (current.work as Record<string, unknown>).title === 'Nocturno en Medellin',
     'se copia en profundidad; mutar la entrada corrompería lo publicado')
}

// ---- la forma de la enmienda
{
  const next = amendRecord(current, { year: 2026 }, meta)
  ok('se declara enmienda', next.type === 'amendment')
  ok('la secuencia sube de uno', next.sequence === 2, 'el orden es por entero, nunca por fecha')
  ok('nombra a quien supersede', next.supersedes === AR)
  ok('es de clase minor', next.amendment_class === 'minor')
  ok('el motivo se publica sin espacios sobrantes', next.amendment_reason === 'Título mal escrito.')
  ok('van las dos personas', JSON.stringify(next.decided_by) === JSON.stringify({ initiator: A, approver: B }))
  ok('el año corregido', (next.work as Record<string, unknown>).year === 2026)
}

// ---- vacío borra, no publica una cadena vacía
{
  const next = amendRecord(current, { technique: '' }, meta)
  ok('un valor vacío quita el campo', !('technique' in (next.work as Record<string, unknown>)),
     'ausente y nulo no se distinguen en la forma canónica')
  ok('y el resto sigue', (next.work as Record<string, unknown>).category === 'painting')
}

// ---- lo que la clase minor NO puede tocar
{
  throws('el hash del contenido no es enmendable', () =>
    amendRecord(current, { content_hash: 'sha256:' + 'c'.repeat(64) } as never, meta))
  throws('la identidad del creador tampoco', () =>
    amendRecord(current, { creator: { name: 'Otra' } } as never, meta))
  throws('ni la declaración de originalidad', () =>
    amendRecord(current, { originality: 'derivative' } as never, meta))
  throws('ni el TBT', () => amendRecord(current, { tbt_id: 'TBT-2026-OTHER1' } as never, meta))
  throws('la clase authorship no está construida', () =>
    amendRecord(current, { title: 'x' }, { ...meta, amendmentClass: 'authorship' }))
}

// ---- una enmienda sin motivo es una reescritura silenciosa
{
  throws('sin motivo lanza', () => amendRecord(current, { title: 'x' }, { ...meta, reason: '   ' }))
  throws('sin a quién supersede lanza', () => amendRecord(current, { title: 'x' }, { ...meta, supersedes: '' }))
  throws('la regla de dos personas se comprueba aquí también', () =>
    amendRecord(current, { title: 'x' }, { ...meta, decidedBy: { initiator: A, approver: A } }))
  throws('sin nada que corregir lanza', () => amendRecord(current, {}, meta))
  throws('un registro de otro esquema lanza', () =>
    amendRecord({ ...current, schema: 'tbt.record.v0' }, { title: 'x' }, meta))
  throws('un registro sin secuencia utilizable lanza', () =>
    amendRecord({ ...current, sequence: 0 }, { title: 'x' }, meta))
}

// ---- la cadena se camina hacia atrás
{
  const second = amendRecord(current, { title: 'Nocturno' }, meta)
  const third = amendRecord(second, { city: 'Bogotá' }, { ...meta, supersedes: 'https://arweave.net/second' })
  ok('la segunda enmienda es la secuencia 3', third.sequence === 3)
  ok('y supersede a la anterior', third.supersedes === 'https://arweave.net/second')
  ok('conservando la corrección anterior', (third.work as Record<string, unknown>).title === 'Nocturno',
     'se enmienda lo publicado, no lo que diga la base')
}

// ---- qué cambió, para la bitácora
{
  const next = amendRecord(current, { title: 'Nocturno en Medellín', city: 'Bogotá' }, meta)
  const diff = amendmentDiff(current, next)
  ok('el diff nombra exactamente lo que cambió',
     Object.keys(diff).sort().join(',') === 'city,title')
  ok('con el antes y el después', diff.city.from === 'Medellin' && diff.city.to === 'Bogotá')
}

// ---- serializa y se puede anclar
{
  const next = amendRecord(current, { title: 'Nocturno en Medellín' }, meta)
  const s = canonicalize(next)
  ok('la reserialización reproduce los mismos bytes', canonicalize(JSON.parse(s)) === s)
  ok('tiene hash', /^[0-9a-f]{64}$/.test(recordHash(next)))
  ok('el hash es distinto del que supersede', recordHash(next) !== recordHash(current))
}

// ---- la guarda del Item 10 sigue delante
{
  const next = amendRecord(current, { title: 'Nocturno en Medellín' }, meta)
  let threw = false
  try { assertNoIdentifiers(next) } catch { threw = true }
  ok('una enmienda con seudónimos pasa', !threw)

  throws('con los UUID de verdad no', () =>
    assertNoIdentifiers(amendRecord(current, { title: 'x' }, {
      ...meta,
      decidedBy: { initiator: '5b84cf07-6516-4873-bfdd-379805913c4d', approver: '51272678-0000-4000-8000-000000000000' },
    })))
}

// ---- los ocho campos del spec
{
  ok('son los ocho de la clase minor',
     MINOR_FIELDS.slice().sort().join(',') === 'category,city,country,series,statement,technique,title,year')
}

// ---------------------------------------------------------------- el cableado
//
// Sobre CONSTRUCCIONES del código, nunca sobre la prosa.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const route = read('src/app/api/admin/works/amend/route.ts')
const nft = read('src/lib/solana/nft.ts')
const mig = read('supabase/migrations/038_work_amendments.sql')
const page = read('src/app/admin/page.tsx')

{
  ok('no se enmienda lo que no se puede reproducir',
     route.indexOf('fetchCurrentRecord(') > 0 &&
     route.indexOf('fetchCurrentRecord(') < route.indexOf('amendRecord('),
     'los bytes servidos tienen que hashear a lo que guardamos')
  ok('y el hash se compara de verdad', route.includes('got !== expectedHash'))
  ok('publica antes de mover nada nuestro',
     route.indexOf('publishRecord(') < route.indexOf("from('works').update("))
  ok('guarda la URI nueva antes de repuntar la cadena',
     route.indexOf('registration_record_uri: published.uri') < route.indexOf('repointNft('))
  ok('un repunte fallido no tumba la enmienda',
     route.includes("console.error('[chain] la enmienda se publicó pero el NFT no se repuntó:'"))
  ok('una obra sin registro no se puede enmendar', route.includes("'no_registration_record'"))
  ok('pasa por la regla de dos personas', route.includes("action: 'work.amend'"))
  ok('la serie se resuelve del servidor y del mismo creador',
     route.includes('series.creator_id !== work.creator_id'))
  ok('el motivo es obligatorio', route.includes("'reason_required'"))
}

{
  const fn = nft.slice(nft.indexOf('export async function repointNft'))
  ok('repuntar solo mueve la URI', fn.includes('update({ nftOrSft: nft, uri })'),
     'reescribir el nombre arriesga un truncamiento a cambio de nada')
  ok('y no toca un activo inmutable', fn.includes('!nft.isMutable'))
  ok('el updateNftMetadata muerto ya no está', !nft.includes('export async function updateNftMetadata'))
}

{
  ok('una enmienda es de alto riesgo', HIGH_RISK.has('works.amend'))
  ok('el panel sabe pedirla', page.includes('async function requestAmendment'))
  ok('y enseña las que ya hay', page.includes('work.amendments.map'))
  ok('el panel ya no niega la cadena',
     !page.includes('Arweave and Bitcoin anchors are not written yet.'),
     'lo decía mientras la base ya guardaba las dos')
}

{
  ok('una secuencia por TBT y no más', mig.includes('unique (tbt_id, sequence_number)'))
  ok('y quien aprueba nunca es quien inicia', mig.includes('check (approved_by <> initiated_by)'))
  ok('la clase se limita en la base', mig.includes("check (amendment_class in ('minor', 'authorship'))"))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
