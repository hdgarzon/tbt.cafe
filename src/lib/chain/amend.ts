/**
 * El registro que SUPERSEDE — Chain Implementation Spec 01, Item 5.
 *
 * Un registro no se edita nunca. Una correccion es un registro NUEVO que nombra
 * al que supersede: el mas reciente es el vigente por definicion, el original
 * sigue legible para siempre, y la cadena entre los dos es el historial de
 * correcciones. Es el modelo del registro vehicular — un titulo se reexpide, no
 * se reescribe.
 *
 * SE ENMIENDA LO PUBLICADO, NO LO QUE DIGA LA BASE
 *
 * La enmienda se construye COPIANDO el registro que ya esta en Arweave y
 * aplicandole la correccion encima. No se rearma desde `works`.
 *
 * La diferencia importa. Rearmarlo desde la base publicaria como «correccion»
 * cualquier deriva que hubiera ocurrido por otro motivo entre el sellado y hoy
 * —una columna que cambio de forma, un valor por defecto nuevo— sin que nadie
 * la pidiera ni la revisara. Copiando, lo unico que cambia es lo que alguien
 * escribio y otra persona aprobo, y todo lo demas viaja intacto aunque este
 * archivo no sepa que existe.
 *
 * QUE PUEDE CAMBIAR
 *
 * Solo la clase `minor`, que es la unica que el spec deja construir: titulo mal
 * escrito, año equivocado, categoria, tecnica, serie, ciudad o pais, y la
 * redaccion del Contexto. Publica de inmediato al aprobarse.
 *
 * La clase `authorship` —identidad del creador y declaracion de originalidad—
 * NO se construye. Su aviso: si la obra superseida ya se vendio, quedan en el
 * aire si la regalia sigue a la autoria, que tiene el coleccionista y si la
 * venta se sostiene. Es la pregunta 30 para asesoria legal.
 *
 * Y el hash del contenido no es enmendable por nadie. Si cambia es OTRA obra y
 * necesita su propio TBT: es el unico limite duro del Item 5.
 */
import { RECORD_SCHEMA } from './serialize'
import type { AmendmentClass } from './records'

/** Lo que una enmienda `minor` puede corregir, y nada mas. */
export type MinorPatch = {
  title?: string
  year?: number
  category?: string
  technique?: string
  series?: string
  city?: string
  country?: string
  statement?: string
}

export const MINOR_FIELDS = [
  'title', 'year', 'category', 'technique', 'series', 'city', 'country', 'statement',
] as const

/** Donde vive cada campo dentro del registro. */
const PATH: Record<keyof MinorPatch, [container: 'work' | 'context' | 'root', key: string]> = {
  title: ['work', 'title'],
  year: ['work', 'year'],
  category: ['work', 'category'],
  technique: ['work', 'technique'],
  series: ['root', 'series'],
  city: ['context', 'city'],
  country: ['context', 'country'],
  statement: ['context', 'statement'],
}

/**
 * Lo que la clase `minor` NO puede tocar, comprobado sobre el resultado.
 *
 * La lista de campos permitidos ya lo impide por construccion. Esto es la
 * segunda vuelta: se compara el registro nuevo contra el viejo y se exige que
 * nada de aqui haya cambiado, venga el cambio de donde venga.
 */
const IMMUTABLE_IN_MINOR = ['schema', 'tbt_id', 'content_hash', 'creator', 'sealed_at', 'issuer'] as const

type Record_ = Record<string, unknown>

export type AmendmentMeta = {
  /** La URI del registro vigente, el que esta enmienda supersede. */
  supersedes: string
  reason: string
  /** Seudonimos, nunca UUID. La guarda del Item 10 lo comprueba igualmente. */
  decidedBy: { initiator: string; approver: string }
  amendmentClass?: AmendmentClass
}

const isEmptyPatch = (p: MinorPatch): boolean =>
  MINOR_FIELDS.every((k) => p[k] === undefined)

/**
 * Construye la enmienda a partir del registro vigente.
 *
 * Un valor vacio BORRA el campo, porque un registro canonico no distingue entre
 * ausente y nulo (Item 3): dejar `technique: ''` publicaria una cadena vacia
 * donde lo correcto es que el campo no este.
 */
export function amendRecord(current: Record_, patch: MinorPatch, meta: AmendmentMeta): Record_ {
  if (!current || typeof current !== 'object') throw new Error('amend: no hay registro vigente que superseder.')
  if (current.schema !== RECORD_SCHEMA) {
    throw new Error(`amend: el registro vigente declara '${String(current.schema)}', no '${RECORD_SCHEMA}'.`)
  }
  if (typeof current.sequence !== 'number' || !Number.isInteger(current.sequence) || current.sequence < 1) {
    throw new Error('amend: el registro vigente no lleva una secuencia utilizable.')
  }
  if (!meta.supersedes) throw new Error('amend: una enmienda debe nombrar a quien supersede.')
  if (!meta.reason?.trim()) {
    throw new Error('amend: una enmienda sin motivo es una reescritura silenciosa. El motivo se publica.')
  }
  if (!meta.decidedBy?.initiator || !meta.decidedBy?.approver) {
    throw new Error('amend: toda enmienda es de alto riesgo — se nombran iniciador y aprobador.')
  }
  if (meta.decidedBy.initiator === meta.decidedBy.approver) {
    throw new Error('amend: la regla de dos personas exige que iniciador y aprobador sean distintos.')
  }
  if ((meta.amendmentClass ?? 'minor') !== 'minor') {
    // El spec: «do not build the authorship class past this point».
    throw new Error('amend: solo la clase minor esta construida. La de autoria espera a la pregunta 30.')
  }

  const unknown = Object.keys(patch).filter((k) => !(MINOR_FIELDS as readonly string[]).includes(k))
  if (unknown.length) {
    throw new Error(`amend: la clase minor no puede cambiar ${unknown.join(', ')}.`)
  }
  if (isEmptyPatch(patch)) throw new Error('amend: no hay nada que corregir.')

  // Copia profunda del registro vigente: lo que este archivo no conoce viaja
  // igual. Es lo que hace que un campo añadido despues no se pierda al enmendar.
  const next: Record_ = JSON.parse(JSON.stringify(current))

  const work = { ...((next.work as Record_) ?? {}) }
  const context = { ...((next.context as Record_) ?? {}) }

  for (const key of MINOR_FIELDS) {
    const value = patch[key]
    if (value === undefined) continue

    const [container, field] = PATH[key]
    const target = container === 'work' ? work : container === 'context' ? context : next

    if (typeof value === 'string' && value.trim() === '') delete target[field]
    else target[field] = typeof value === 'string' ? value.trim() : value
  }

  next.work = work
  if (Object.keys(context).length) next.context = context
  else delete next.context

  next.type = 'amendment'
  next.sequence = (current.sequence as number) + 1
  next.supersedes = meta.supersedes
  next.amendment_class = 'minor'
  next.amendment_reason = meta.reason.trim()
  next.decided_by = { initiator: meta.decidedBy.initiator, approver: meta.decidedBy.approver }

  for (const key of IMMUTABLE_IN_MINOR) {
    if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) {
      throw new Error(`amend: la clase minor no puede cambiar '${key}'.`)
    }
  }

  return next
}

/** Que cambio de verdad, para la bitacora y para el panel. */
export function amendmentDiff(current: Record_, next: Record_): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of MINOR_FIELDS) {
    const [container, field] = PATH[key]
    const pick = (r: Record_) =>
      container === 'root' ? r[field] : ((r[container] as Record_) ?? {})[field]
    const from = pick(current)
    const to = pick(next)
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from: from ?? null, to: to ?? null }
  }
  return out
}
