import { readFileSync } from 'fs'
import { join } from 'path'
import { pseudonymFor, assertNoIdentifiers, UUID_RE } from '../src/lib/chain/pseudonym'
import { canonicalize } from '../src/lib/chain/serialize'
import { registrationRecord, provenanceRecord } from '../src/lib/chain/records'

/** Arweave no se borra. Lo que sube, sube para siempre. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'no lanzó') } catch { ok(label, true) }
}

const UUID = '5b84cf07-6516-4873-bfdd-379805913c4d'
const OTHER = '7393fadd-77b1-4399-9bd9-2dee166b68be'

// ---- el seudónimo
{
  const a = pseudonymFor(UUID)
  ok('lleva prefijo cr_', a.startsWith('cr_'))
  ok('no contiene el UUID', !a.includes(UUID) && !a.includes('5b84cf07'))
  ok('es estable', pseudonymFor(UUID) === a, 'la cadena de procedencia depende de que no cambie')
  ok('distingue personas', pseudonymFor(OTHER) !== a)
  ok('es corto y opaco', a.length <= 16 && /^cr_[0-9a-f]+$/.test(a))
}

// ---- el mismo seudónimo sin importar el papel
{
  ok('creador y comprador son la misma persona si el id lo es',
     pseudonymFor(UUID) === pseudonymFor(UUID),
     'un prefijo por papel rompería el enlace entre registros')
}

// ---- LA GUARDA: nada que identifique llega a Arweave
{
  ok('reconoce un UUID', UUID_RE.test(UUID))
  ok('en mayúsculas también', UUID_RE.test(UUID.toUpperCase()))

  throws('un UUID en el registro lanza', () =>
    assertNoIdentifiers({ schema: 'x', type: 'registration', creator: { id: UUID } }))
  throws('un correo lanza', () =>
    assertNoIdentifiers({ schema: 'x', type: 'registration', context: { statement: 'sara@example.com' } }))
  throws('un teléfono internacional lanza', () =>
    assertNoIdentifiers({ schema: 'x', type: 'registration', note: 'llamar al +573001234567' }))
  throws('un par de coordenadas lanza', () =>
    assertNoIdentifiers({ context: { statement: 'Pintado en 4.60971, -74.08175' } }))
  throws('anidado profundo también', () =>
    assertNoIdentifiers({ a: { b: { c: [{ d: UUID }] } } }))

  // Un año y un número corriente NO son coordenadas.
  let clean = false
  try { assertNoIdentifiers({ work: { year: 2026, price: '12, 40' } }); clean = true } catch { /* */ }
  ok('un par sin decimales no se confunde', clean)

  let threw = false
  try { assertNoIdentifiers({ creator: { id: pseudonymFor(UUID), name: 'Sara Alarcón' } }) }
  catch { threw = true }
  ok('un registro limpio pasa', !threw)
}

// ---- los registros de verdad, ya seudonimizados
{
  const reg = registrationRecord({
    tbtId: 'TBT-2026-ABC123', sequence: 1,
    contentHash: 'sha256:' + 'a'.repeat(64),
    creator: { name: 'Sara Alarcón', id: pseudonymFor(UUID), type: 'individual' },
    work: { title: 'Nocturno', year: 2026, originality: 'original' },
    sealedAt: new Date(Date.UTC(2026, 7, 26)),
  })
  ok('el registro de registración no lleva UUID', !UUID_RE.test(canonicalize(reg)))

  const prov = provenanceRecord({
    tbtId: 'TBT-2026-ABC123', sequence: 2, event: 'sale',
    from: { name: 'Sara', id: pseudonymFor(UUID) },
    to: { name: 'Diego', id: pseudonymFor(OTHER) },
    occurredAt: new Date(Date.UTC(2026, 7, 27)),
    priorRecord: 'sha256:' + 'b'.repeat(64),
    registrationRecord: 'https://arweave.net/abc',
  })
  ok('el de procedencia tampoco', !UUID_RE.test(canonicalize(prov)))
}

// ---- LA GUARDA: los sitios que publican no pasan un UUID
{
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

  const tbt = read('src/app/api/complete-tbt/route.ts')
  const xfer = read('src/app/api/complete-transfer/route.ts')
  const ar = read('src/lib/chain/arweave.ts')

  ok('la certificación seudonimiza al creador', !/id: workWithCreator\.creator_id\b/.test(tbt))
  // `[^_]` a proposito: `current_owner_id:` y `owner_user_id:` son escrituras
  // a la base, no al registro, y contienen la misma subcadena.
  ok('la transferencia seudonimiza a las dos partes',
     !/[^_]id: transfer\.(from|to)_owner_id\b/.test(xfer))
  ok('y ambas usan pseudonymFor', tbt.includes('pseudonymFor(') && xfer.includes('pseudonymFor('))
  ok('nada sube sin pasar la guarda', ar.includes('assertNoIdentifiers(record)'),
     'es el único punto por el que pasa todo lo que llega a Arweave')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
