import { canonicalize, recordHash, RECORD_SCHEMA } from '../src/lib/chain/serialize'

/**
 * Prueba de ida y vuelta del serializador canonico — Chain Spec 01, Item 3.
 *
 * Escrita ANTES que el serializador, como pide el spec, y por el motivo que da:
 * el fallo que esto previene es silencioso y solo aparece anos despues, cuando
 * un hash deja de coincidir y ya no hay forma de saber que lado cambio.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'no lanzo'); } catch { ok(label, true) }
}

const base = { schema: RECORD_SCHEMA, tbtId: 'TBT-2026-9FABA0' }

// ---- ida y vuelta: serializar, parsear, re-serializar, comparar bytes
const roundTrip = (label: string, record: object) => {
  const once = canonicalize(record)
  const twice = canonicalize(JSON.parse(once))
  ok(`ida y vuelta · ${label}`, once === twice, `${once.slice(0, 60)} != ${twice.slice(0, 60)}`)
}

roundTrip('simple', { ...base, title: 'Untitled' })
roundTrip('acentos', { ...base, title: 'Añoranza — José Martínez, Chapultepec' })
roundTrip('emoji BMP', { ...base, title: 'sol ☀ luna ☾' })
roundTrip('emoji astral', { ...base, title: 'obra 🎨🖼️ de 👩‍🎨' })
roundTrip('anidado', { ...base, work: { commerce: { price: 12000, royalty: { type: 'fixed', value: 200000 } } } })
roundTrip('array', { ...base, owners: ['a', 'b', 'c'] })
roundTrip('statement 5000', { ...base, contextCore: 'á🎨 '.repeat(1250).slice(0, 5000) })
roundTrip('dinero 0', { ...base, priceCents: 0 })
roundTrip('dinero 999999', { ...base, priceCents: 999999 })

// ---- el orden de insercion no puede cambiar el resultado
ok('orden de claves irrelevante',
  canonicalize({ b: 1, a: 2, schema: RECORD_SCHEMA }) === canonicalize({ schema: RECORD_SCHEMA, a: 2, b: 1 }))

// ---- orden por PUNTO DE CODIGO, no por unidad UTF-16.
// 'Z' U+005A · 'Ａ' U+FF21 · '𝐀' U+1D400. Por punto de codigo ese es el orden.
// Un `.sort()` ingenuo compara unidades UTF-16 y pone el astral en medio,
// porque su primera unidad (0xD835) cae por debajo de 0xFF21. Esa diferencia
// es todo el motivo de que exista compareByCodePoint.
{
  const claves = ['Z', 'Ａ', '𝐀']
  const s = canonicalize(Object.fromEntries(claves.map((k, i) => [k, i])))
  const order = Array.from(s.matchAll(/"((?:[^"\\]|\\.)*)":/g), (m) => m[1])
  ok('orden por punto de codigo', JSON.stringify(order) === JSON.stringify(['Z', 'Ａ', '𝐀']),
     JSON.stringify(order))

  const ingenuo = [...claves].sort()
  ok('la prueba distingue de un sort ingenuo',
     JSON.stringify(ingenuo) !== JSON.stringify(['Z', 'Ａ', '𝐀']),
     `sort() dio ${JSON.stringify(ingenuo)}`)
}

// ---- ausente y null son indistinguibles
ok('null se omite', canonicalize({ a: 1, b: null }) === canonicalize({ a: 1 }))
ok('undefined se omite', canonicalize({ a: 1, b: undefined }) === canonicalize({ a: 1 }))
ok('anidado null se omite', canonicalize({ a: { x: 1, y: null } }) === canonicalize({ a: { x: 1 } }))

// ---- NFC: compuesto y descompuesto deben producir los mismos bytes
{
  const compuesto: string = 'A\u00F1oranza'          // n con tilde en un solo punto
  const descompuesto: string = 'An\u0303oranza'      // n + combinante U+0303
  ok('NFC en valores', canonicalize({ t: compuesto }) === canonicalize({ t: descompuesto }))
  ok('NFC en claves', canonicalize({ [compuesto]: 1 }) === canonicalize({ [descompuesto]: 1 }))
  ok('NFC cambia los bytes de origen', compuesto !== descompuesto)
}

// ---- sin espacios en blanco
ok('sin espacios', !/[\s]/.test(canonicalize({ a: 1, b: 'x' }).replace(/"[^"]*"/g, '""')))

// ---- numeros
ok('entero', canonicalize({ n: 42 }) === '{"n":42}')
ok('cero', canonicalize({ n: 0 }) === '{"n":0}')
ok('negativo', canonicalize({ n: -7 }) === '{"n":-7}')
throws('rechaza decimal', () => canonicalize({ n: 12.5 }))
throws('rechaza NaN', () => canonicalize({ n: NaN }))
throws('rechaza Infinity', () => canonicalize({ n: Infinity }))
throws('rechaza notacion exponencial', () => canonicalize({ n: 1e21 }))

// ---- fechas
ok('Date a ISO con Z y sin fraccion',
  canonicalize({ d: new Date(Date.UTC(2026, 7, 26, 14, 3, 22, 456)) }) === '{"d":"2026-08-26T14:03:22Z"}')

// ---- hash
{
  const r = { ...base, title: 'Añoranza' }
  const h = recordHash(r)
  ok('hash en hex minuscula de 64', /^[0-9a-f]{64}$/.test(h), h)
  ok('hash estable', h === recordHash(JSON.parse(canonicalize(r))))
  ok('hash sensible al contenido', h !== recordHash({ ...r, title: 'Otra' }))
  throws('recordHash exige el schema', () => recordHash({ tbtId: 'x' }))
}

console.log(bad === 0 ? '\nTodo correcto.' : `\n${bad} fallo(s).`)
process.exit(bad === 0 ? 0 : 1)
