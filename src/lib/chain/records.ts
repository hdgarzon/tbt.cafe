import { RECORD_SCHEMA } from '@/lib/chain/serialize'

/**
 * Los tres registros de Arweave — Chain Implementation Spec 01, Item 4.
 *
 * Cada uno se escribe UNA VEZ y no se reescribe nunca. Registración y
 * procedencia van como artefactos separados a proposito: asi la actividad
 * comercial no puede alcanzar hacia atras y alterar la reivindicacion de
 * autoria. Una transferencia jamas toca la cadena de registración, y una
 * enmienda jamas toca la de procedencia.
 *
 * Estas funciones son PURAS: construyen y validan, no publican. Lo que sale de
 * aqui pasa por `canonicalize` y se sube; si algo esta mal, tiene que fallar
 * aqui — despues de Arweave ya no hay vuelta atras.
 */

export type CreatorType = 'individual' | 'group' | 'corporation'
export type Originality = 'original' | 'derivative' | 'authorized_edition'
export type ProvenanceEvent = 'creation' | 'sale' | 'transfer' | 'gift'
export type AmendmentClass = 'minor' | 'authorship'

const EVENTS: ProvenanceEvent[] = ['creation', 'sale', 'transfer', 'gift']

/**
 * Ausente por diseño, y esta lista es la guarda.
 *
 * Precio y regalia CAMBIAN a lo largo de la vida de la obra: un registro
 * permanente de ellos nace correcto y se vuelve mentira. El codigo de
 * transferencia es una credencial. Dueño, coordenadas, telefono y correo son de
 * la persona, no de la obra.
 *
 * La prueba serializa un registro contaminado con todos ellos y comprueba que
 * ninguno sobrevive. Ensanchar el constructor sin pensarlo falla ahi, que es
 * donde todavia se puede arreglar.
 */
export const FORBIDDEN_IN_REGISTRATION = [
  'price', 'royalty', 'royalty_type', 'royalty_value',
  'transfer_code', 'transferCode', 'owner', 'current_owner',
  'coordinates', 'lat', 'lng', 'phone', 'email',
] as const

function assertSequence(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    // El orden es por entero, nunca por fecha: los relojes se desvian y las
    // marcas de tiempo colisionan (Item 5). Cual registro es el vigente no
    // puede quedar ambiguo jamas.
    throw new Error(`records: sequence debe ser un entero >= 1, recibido ${n}.`)
  }
}

function assertContentHash(h: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(h)) {
    throw new Error('records: content_hash debe ser sha256: seguido de 64 hex en minuscula.')
  }
}

const iso = (d: Date): string => {
  if (Number.isNaN(d.getTime())) throw new Error('records: fecha invalida.')
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export type RegistrationInput = {
  tbtId: string
  sequence: number
  contentHash: string
  creator: { name: string; id: string; type: CreatorType }
  work: { title: string; year: number; category?: string; technique?: string; originality: Originality }
  context?: { statement?: string; city?: string; country?: string }
  series?: string
  sealedAt: Date
}

export type RegistrationRecord = {
  schema: typeof RECORD_SCHEMA
  type: 'registration'
  tbt_id: string
  sequence: number
  content_hash: string
  creator: { name: string; id: string; type: CreatorType }
  work: { title: string; year: number; category?: string; technique?: string; originality: Originality }
  context?: { statement?: string; city?: string; country?: string }
  series?: string
  sealed_at: string
  issuer: 'tbt.cafe'
}

/**
 * El registro de registración: quien hizo que, y que archivo era.
 *
 * Se construye campo a campo desde la entrada — nunca por propagacion — para
 * que un objeto de origen con campos de mas no pueda arrastrarlos hasta un
 * almacen permanente.
 */
export function registrationRecord(input: RegistrationInput): RegistrationRecord {
  assertSequence(input.sequence)
  assertContentHash(input.contentHash)
  if (!input.tbtId) throw new Error('records: falta tbt_id.')
  if (!input.work?.title) throw new Error('records: falta el titulo de la obra.')

  const context =
    input.context && (input.context.statement || input.context.city || input.context.country)
      ? {
          ...(input.context.statement ? { statement: input.context.statement } : {}),
          ...(input.context.city ? { city: input.context.city } : {}),
          ...(input.context.country ? { country: input.context.country } : {}),
        }
      : undefined

  return {
    schema: RECORD_SCHEMA,
    type: 'registration',
    tbt_id: input.tbtId,
    sequence: input.sequence,
    content_hash: input.contentHash,
    creator: { name: input.creator.name, id: input.creator.id, type: input.creator.type },
    work: {
      title: input.work.title,
      year: input.work.year,
      ...(input.work.category ? { category: input.work.category } : {}),
      ...(input.work.technique ? { technique: input.work.technique } : {}),
      originality: input.work.originality,
    },
    ...(context ? { context } : {}),
    ...(input.series ? { series: input.series } : {}),
    sealed_at: iso(input.sealedAt),
    issuer: 'tbt.cafe',
  }
}

export type ProvenanceInput = {
  tbtId: string
  sequence: number
  event: ProvenanceEvent
  from?: { name: string; id: string }
  to: { name: string; id: string }
  occurredAt: Date
  solanaSignature?: string
  priorRecord?: string
  registrationRecord: string
}

export type ProvenanceRecord = {
  schema: typeof RECORD_SCHEMA
  type: 'provenance'
  tbt_id: string
  sequence: number
  event: ProvenanceEvent
  from?: { name: string; id: string }
  to: { name: string; id: string }
  occurred_at: string
  solana_signature?: string
  prior_record?: string
  registration_record: string
}

/**
 * El registro de procedencia: quien la tuvo, cuando y por que evento.
 *
 * `prior_record` se omite SOLO en la secuencia 1. Que falte en cualquier otra
 * rompe la cadena en silencio: quedaria un eslabon sin anterior, y nadie
 * podria distinguir eso de un origen.
 */
export function provenanceRecord(input: ProvenanceInput): ProvenanceRecord {
  assertSequence(input.sequence)
  if (!EVENTS.includes(input.event)) {
    throw new Error(`records: evento desconocido '${input.event}'. Solo ${EVENTS.join(' | ')}.`)
  }
  if (input.sequence === 1 && input.priorRecord) {
    throw new Error('records: la secuencia 1 no puede tener prior_record — es el origen.')
  }
  if (input.sequence > 1 && !input.priorRecord) {
    throw new Error('records: prior_record es obligatorio a partir de la secuencia 2.')
  }
  if (!input.registrationRecord) throw new Error('records: falta registration_record.')

  return {
    schema: RECORD_SCHEMA,
    type: 'provenance',
    tbt_id: input.tbtId,
    sequence: input.sequence,
    event: input.event,
    ...(input.from ? { from: { name: input.from.name, id: input.from.id } } : {}),
    to: { name: input.to.name, id: input.to.id },
    occurred_at: iso(input.occurredAt),
    ...(input.solanaSignature ? { solana_signature: input.solanaSignature } : {}),
    ...(input.priorRecord ? { prior_record: input.priorRecord } : {}),
    registration_record: input.registrationRecord,
  }
}

export type AmendmentInput = RegistrationInput & {
  supersedes: string
  amendmentClass: AmendmentClass
  amendmentReason: string
  decidedBy: { initiator: string; approver: string }
  /** Si se pasa, se comprueba que el hash de contenido NO cambio. */
  priorContentHash?: string
}

export type AmendmentRecord = RegistrationRecord & {
  supersedes: string
  amendment_class: AmendmentClass
  amendment_reason: string
  decided_by: { initiator: string; approver: string }
}

/**
 * La enmienda: un registro de registración completo que SUPERSEDE a otro.
 *
 * No reemplaza nada. El original sigue legible para siempre y la cadena entre
 * los dos es el historial de correcciones — el modelo del registro vehicular:
 * un titulo se reexpide, no se reescribe.
 *
 * El motivo es texto libre y SE PUBLICA. No es un desplegable ni una nota
 * interna: lo que impide que este camino se vuelva una reescritura silenciosa
 * es que cada reescritura es permanente, fechada, y lleva el motivo de una
 * persona en sus propias palabras.
 *
 * ADVERTENCIA — la clase `authorship` esta aceptada como tipo pero su FLUJO no
 * debe construirse. El spec lo deja sin resolver: si la obra superseida ya se
 * vendio, quedan en el aire si la regalia sigue a la autoria, que tiene el
 * coleccionista y si la venta se sostiene. Es la pregunta 30 para asesoria
 * legal. La clase `minor` si puede construirse mientras tanto.
 */
export function amendmentRecord(input: AmendmentInput): AmendmentRecord {
  if (!input.supersedes) throw new Error('records: una enmienda debe nombrar a quien supersede.')
  if (!input.amendmentReason?.trim()) {
    throw new Error('records: una enmienda sin motivo es una reescritura silenciosa. El motivo se publica.')
  }
  if (!input.decidedBy?.initiator || !input.decidedBy?.approver) {
    throw new Error('records: toda enmienda es de alto riesgo — se nombran iniciador y aprobador.')
  }
  if (input.decidedBy.initiator === input.decidedBy.approver) {
    throw new Error('records: la regla de dos personas exige que iniciador y aprobador sean distintos.')
  }
  if (input.priorContentHash && input.priorContentHash !== input.contentHash) {
    // El unico limite duro del Item 5: si el hash cambia es OTRA obra y
    // necesita su propio TBT. Todo lo demas es enmendable.
    throw new Error('records: el hash de contenido no es enmendable. Otro archivo es otra obra y necesita otro TBT.')
  }

  return {
    ...registrationRecord(input),
    supersedes: input.supersedes,
    amendment_class: input.amendmentClass,
    amendment_reason: input.amendmentReason.trim(),
    decided_by: { initiator: input.decidedBy.initiator, approver: input.decidedBy.approver },
  }
}
