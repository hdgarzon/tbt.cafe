import { createHash } from 'crypto'

/**
 * Serializacion canonica — Chain Implementation Spec 01, Item 3.
 *
 * Un registro tiene que reproducirse byte a byte dentro de anos o la atestacion
 * en Bitcoin falla y el certificado no vale nada. Por eso aqui no hay ninguna
 * decision libre: orden de claves, espacios, formato de numeros y normalizacion
 * Unicode estan todos fijados.
 *
 * `canonicalize` y `recordHash` son PURAS. Ni entrada/salida, ni reloj, ni
 * lectura de entorno: un registro debe serializar igual en cualquier maquina y
 * en cualquier ano. Si alguna vez hace falta la hora, entra como dato.
 */

export const RECORD_SCHEMA = 'tbt.record.v1'

/**
 * Orden lexicografico por PUNTO DE CODIGO, no por unidad UTF-16.
 *
 * `Array.prototype.sort()` compara unidades UTF-16, y eso difiere para todo lo
 * que esta fuera del BMP: un emoji (par suplente, 0xD800-0xDFFF) queda ANTES
 * que un caracter de ancho completo como 'Ａ' (U+FF21), cuando por punto de
 * codigo va despues. Una obra con emoji en una clave bastaria para que el hash
 * dejara de reproducirse.
 */
function compareByCodePoint(a: string, b: string): number {
  // Array.from recorre por punto de codigo igual que el spread, sin exigir
  // downlevelIteration con el target de este proyecto.
  const ca = Array.from(a)
  const cb = Array.from(b)
  const n = Math.min(ca.length, cb.length)
  for (let i = 0; i < n; i++) {
    const x = ca[i].codePointAt(0)!
    const y = cb[i].codePointAt(0)!
    if (x !== y) return x - y
  }
  return ca.length - cb.length
}

/** NFC en toda cadena, clave o valor: compuesto y descompuesto se ven igual. */
const nfc = (s: string): string => s.normalize('NFC')

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`canonicalize: numero no finito (${n}). Un registro no puede contener NaN ni Infinity.`)
  }
  if (!Number.isInteger(n)) {
    // El dinero va en centavos enteros (§ Numbers). Un decimal aqui casi
    // siempre significa que alguien paso dolares donde iban centavos, y
    // redondearlo en silencio produciria un hash que no cuadra con el importe.
    throw new Error(`canonicalize: numero no entero (${n}). El dinero va en centavos enteros; no se admiten flotantes.`)
  }
  const s = String(n)
  if (s.includes('e') || s.includes('E')) {
    throw new Error(`canonicalize: ${n} serializa en notacion exponencial. Fuera del rango representable sin ambiguedad.`)
  }
  return s
}

function serializeValue(v: unknown): string | undefined {
  // Ausente y null son indistinguibles por diseno: quien lea el registro no
  // debe poder inferir que un campo existio y venia vacio.
  if (v === null || v === undefined) return undefined

  if (typeof v === 'string') return JSON.stringify(nfc(v))
  if (typeof v === 'number') return serializeNumber(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error('canonicalize: fecha invalida.')
    // ISO 8601 UTC con segundos y sufijo Z, sin fraccion.
    return JSON.stringify(v.toISOString().replace(/\.\d{3}Z$/, 'Z'))
  }

  if (Array.isArray(v)) {
    // En un array el orden ES dato: se conserva. Un hueco null se vuelve null
    // porque quitarlo correria los indices y cambiaria el significado.
    return '[' + v.map((x) => serializeValue(x) ?? 'null').join(',') + ']'
  }

  if (typeof v === 'object') {
    const entries: Array<[string, string]> = []
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const s = serializeValue(raw)
      if (s !== undefined) entries.push([nfc(k), s])
    }
    entries.sort((a, b) => compareByCodePoint(a[0], b[0]))
    return '{' + entries.map(([k, s]) => `${JSON.stringify(k)}:${s}`).join(',') + '}'
  }

  throw new Error(`canonicalize: tipo no serializable (${typeof v}).`)
}

/** La forma canonica del registro, en UTF-8 sin BOM y sin un solo espacio. */
export function canonicalize(record: unknown): string {
  const s = serializeValue(record)
  if (s === undefined) throw new Error('canonicalize: el registro esta vacio.')
  return s
}

/**
 * SHA-256 en hex minuscula sobre los bytes canonicos.
 *
 * Exige que el registro lleve su `schema`. Sin el, dentro de unos anos habria
 * un hash sin forma de saber que formato describe — y ese es exactamente el
 * momento en que un certificado deja de poder verificarse.
 */
export function recordHash(record: unknown): string {
  const r = record as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || r.schema !== RECORD_SCHEMA) {
    throw new Error(`recordHash: el registro debe declarar schema: '${RECORD_SCHEMA}'.`)
  }
  return createHash('sha256').update(canonicalize(record), 'utf8').digest('hex')
}
