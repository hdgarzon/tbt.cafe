import { createHash } from 'crypto'
import { RECORD_SCHEMA, canonicalize } from '@/lib/chain/serialize'

/**
 * Los registros de Arweave — Chain Implementation Spec 01, Item 4, en la forma
 * final de Work Order Chains 01, Stage 2 (que manda donde difieren).
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
export type ImageKind = 'thumbnail' | 'full' | 'reduced'
export type Originality = 'original' | 'derivative' | 'authorized_edition'
export type ProvenanceEvent = 'creation' | 'sale' | 'transfer' | 'gift' | 'restoring'
export type AmendmentClass = 'minor' | 'authorship'
export type RecordingKind = 'audio' | 'video'

/**
 * Las clases de registro, en un solo sitio (2.1 d). `chain_anchors.record_kind`
 * se comprueba contra la misma lista (071): añadir una clase —el adjunto de
 * TBT-EDNA— es una entrada aqui y una fila alli, no reescribir cada check.
 */
export const RECORD_KINDS = ['registration', 'provenance', 'amendment', 'authentication', 'proof'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

// restoring: un reembolso o una disputa perdida devuelve la obra (decision 57).
const EVENTS: ProvenanceEvent[] = ['creation', 'sale', 'transfer', 'gift', 'restoring']

/**
 * Ausente por diseño, y esta lista es la guarda.
 *
 * La regalia puede cambiar hasta el primer cambio de dueño: va en el registro
 * de procedencia donde se bloquea (2.3), nunca aqui. Precio de lista y codigo
 * de transferencia no van en ningun registro; dueño, coordenadas, telefono y
 * correo son de la persona, no de la obra. `price` salio de la lista (2.2): el
 * valor declarado es ahora un campo con nombre, `declared_value`.
 */
export const FORBIDDEN_IN_REGISTRATION = [
  'royalty', 'royalty_type', 'royalty_value',
  'transfer_code', 'transferCode', 'owner', 'current_owner',
  'coordinates', 'lat', 'lng', 'phone', 'email',
] as const

/** Dinero (2.1 b): centavos enteros y codigo ISO. */
export type Money = { amount_cents: number; currency: string }

function money(m: Money, what: string): Money {
  if (!Number.isInteger(m.amount_cents) || m.amount_cents < 0) {
    throw new Error(`records: ${what} va en centavos enteros no negativos.`)
  }
  if (!/^[A-Z]{3}$/.test(m.currency)) throw new Error(`records: ${what} lleva un codigo de moneda ISO en mayusculas.`)
  return { amount_cents: m.amount_cents, currency: m.currency }
}

/**
 * El ID de una transaccion de Arweave (2.1 a). Un registro cita a otro por su
 * ID desnudo: una URL de pasarela hornearia esa pasarela en un dato permanente.
 * Acepta la URL que se guarda en la base y devuelve el ID; lanza si no lo hay.
 */
export const ARWEAVE_ID_RE = /^[A-Za-z0-9_-]{43}$/

export function arweaveId(uriOrId: string): string {
  const id = /^https:\/\//.test(uriOrId) ? uriOrId.split('?')[0].split('/').filter(Boolean).pop() ?? '' : uriOrId
  if (!ARWEAVE_ID_RE.test(id)) throw new Error(`records: '${uriOrId}' no es un ID de Arweave.`)
  return id
}

/**
 * El codigo del creador (2.2): aleatorio, emitido una vez y guardado en el
 * registro (profiles.creator_code). Reemplaza al seudonimo derivado del UUID,
 * que cualquiera puede calcular porque el UUID aparece en URLs publicas. El
 * seudonimo tenia 12 hex; el codigo 10 caracteres base32, asi que uno no pasa
 * por el otro.
 */
export const CREATOR_CODE_RE = /^cr_[0-9abcdefghjkmnpqrstvwxyz]{10}$/

/**
 * La huella de la firma (2.2): SHA-256 de la serializacion canonica de
 * `works.signature_strokes`, la copia congelada. Los trazos se guardan con un
 * decimal y la serializacion canonica no admite flotantes, asi que cada
 * coordenada entra en decimas enteras. Los trazos nunca se publican.
 */
export function signatureHash(strokes: number[][][]): string {
  const tenths = strokes.map((stroke) => stroke.map((point) => point.map((n) => Math.round(n * 10))))
  return 'sha256:' + createHash('sha256').update(canonicalize(tenths), 'utf8').digest('hex')
}

function assertSequence(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    // El orden es por entero, nunca por fecha: los relojes se desvian y las
    // marcas de tiempo colisionan (Item 5).
    throw new Error(`records: sequence debe ser un entero >= 1, recibido ${n}.`)
  }
}

const KINDS: ImageKind[] = ['thumbnail', 'full', 'reduced']

function assertHash(h: string, what: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(h)) {
    throw new Error(`records: ${what} debe ser sha256: seguido de 64 hex en minuscula.`)
  }
}

const iso = (d: Date): string => {
  if (Number.isNaN(d.getTime())) throw new Error('records: fecha invalida.')
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function assertCreator(c: { name: string; id: string; type: CreatorType }): void {
  if (!c?.name?.trim()) throw new Error('records: falta el nombre acreditado del creador.')
  if (!CREATOR_CODE_RE.test(c.id)) {
    throw new Error('records: creator.id es el codigo aleatorio del creador, nunca un seudonimo calculable.')
  }
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
  /**
   * La copia publicada. `uri` es donde quedo (URL de pasarela o ID); el registro
   * lleva el ID desnudo. `hash` es de los BYTES PUBLICADOS — nunca el
   * `contentHash` (Item 10).
   */
  image?: { uri: string; hash: string; kind: ImageKind }
  /** El valor declarado al registrar. Es la palabra del creador. */
  declaredValue?: Money
  signatureHash?: string
  /** La grabacion del creador, tal como se subio (8.1). El archivo no se publica. */
  recordingHash?: string
  recordingKind?: RecordingKind
  /** Los enlaces tal como se dieron al registrar, en su orden (8.2). */
  assetLinks?: string[]
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
  image?: string
  image_hash?: string
  image_kind?: ImageKind
  declared_value?: Money
  signature_hash?: string
  recording_hash?: string
  recording_kind?: RecordingKind
  asset_links?: string[]
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
  assertHash(input.contentHash, 'content_hash')
  if (!input.tbtId) throw new Error('records: falta tbt_id.')
  if (!input.work?.title) throw new Error('records: falta el titulo de la obra.')
  assertCreator(input.creator)

  // Los tres campos de imagen van juntos o no va ninguno: una URI sin hash es
  // una copia que nadie puede comprobar.
  let image: { image: string; image_hash: string; image_kind: ImageKind } | null = null
  if (input.image) {
    assertHash(input.image.hash, 'el hash de la imagen')
    if (!KINDS.includes(input.image.kind)) {
      throw new Error(`records: clase de imagen desconocida '${input.image.kind}'. Solo ${KINDS.join(' | ')}.`)
    }
    image = { image: arweaveId(input.image.uri), image_hash: input.image.hash, image_kind: input.image.kind }
  }
  if (input.signatureHash) assertHash(input.signatureHash, 'signature_hash')
  if (input.recordingHash) {
    assertHash(input.recordingHash, 'recording_hash')
    if (input.recordingKind !== 'audio' && input.recordingKind !== 'video') {
      throw new Error('records: la grabacion lleva su clase, audio o video.')
    }
  }
  const declared = input.declaredValue ? money(input.declaredValue, 'declared_value') : null
  // Exactamente como se dieron, en su orden; un hueco vacio no es un enlace.
  const links = (input.assetLinks ?? []).filter((l) => l.trim().length > 0)

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
    ...(image ?? {}),
    ...(declared ? { declared_value: declared } : {}),
    ...(input.signatureHash ? { signature_hash: input.signatureHash } : {}),
    ...(input.recordingHash ? { recording_hash: input.recordingHash, recording_kind: input.recordingKind } : {}),
    ...(links.length > 0 ? { asset_links: links } : {}),
    sealed_at: iso(input.sealedAt),
    issuer: 'tbt.cafe',
  }
}

/** El titular en un registro (3.2): su nombre si lo eligio, si no su codigo. Nunca los dos. */
export type HolderInput = { name: string } | { privateCollector: number }
export type RecordHolder = { name: string } | { private_collector: string }

function holderOf(h: HolderInput): RecordHolder {
  const named = 'name' in h
  const coded = 'privateCollector' in h
  if (named === coded) throw new Error('records: el titular va con nombre o con codigo, exactamente uno.')
  if (named) {
    if (!(h as { name: string }).name?.trim()) throw new Error('records: un titular nombrado lleva su nombre.')
    return { name: (h as { name: string }).name }
  }
  const code = (h as { privateCollector: number }).privateCollector
  if (!Number.isInteger(code) || code < 10000 || code > 99999) throw new Error('records: el codigo del titular tiene cinco cifras.')
  return { private_collector: String(code) }
}

/**
 * El valor del cambio (2.3). Venta: lo pagado sin las comisiones de tbt.cafe.
 * Transferencia: el valor declarado. Regalo: cero. Creacion: sin importe.
 * Restitucion: sin importe — la venta que deshace ya dijo cuanto (pendiente de
 * confirmar con Federico: 2.3 no nombra su clase de valor).
 */
export type ProvenanceValue =
  | { kind: 'creation' }
  | { kind: 'restoring' }
  | ({ kind: 'sale' | 'declared' | 'gift' } & Money)

const VALUE_FOR: Record<ProvenanceEvent, ProvenanceValue['kind']> = {
  creation: 'creation',
  sale: 'sale',
  transfer: 'declared',
  gift: 'gift',
  restoring: 'restoring',
}

/** La regalia, solo en el registro del cambio en que se bloquea (2.3). */
export type RecordRoyalty = { type: 'percentage'; basis_points: number } | ({ type: 'fixed' } & Money)

export type ProvenanceInput = {
  tbtId: string
  /** El indice del titular: ownership_history.sequence_number. */
  sequence: number
  /** `<TBT ID>-<sequence>`. */
  titleNumber: string
  event: ProvenanceEvent
  holder: HolderInput
  /** La direccion de esta tenencia en Solana (Stage 4). */
  holdingAddress: string
  value: ProvenanceValue
  royalty?: RecordRoyalty
  occurredAt: Date
  /** La transaccion que minteo (creacion) o movio (todo lo demas) el token. */
  solanaSignature: string
  /** El hash del registro de procedencia anterior. */
  priorRecord?: string
  /** El registro de registración: URL o ID; el registro lleva el ID. */
  registrationRecord: string
}

export type ProvenanceRecord = {
  schema: typeof RECORD_SCHEMA
  type: 'provenance'
  tbt_id: string
  sequence: number
  title_number: string
  event: ProvenanceEvent
  holder: { name?: string; private_collector?: string }
  holding_address: string
  value: { kind: ProvenanceValue['kind']; amount_cents?: number; currency?: string }
  royalty?: RecordRoyalty
  occurred_at: string
  solana_signature: string
  prior_record?: string
  registration_record: string
}

/**
 * El registro de procedencia: quien tiene la obra desde cuando, por que evento
 * y por cuanto.
 *
 * Sin `from` (2.3): quien la tenia ya esta en el registro anterior, bajo su
 * propia eleccion; repetirlo aqui seria una segunda copia de esa decision.
 *
 * `prior_record` se omite SOLO en la secuencia 1. Que falte en cualquier otra
 * rompe la cadena en silencio.
 */
export function provenanceRecord(input: ProvenanceInput): ProvenanceRecord {
  assertSequence(input.sequence)
  if (!EVENTS.includes(input.event)) {
    throw new Error(`records: evento desconocido '${input.event}'. Solo ${EVENTS.join(' | ')}.`)
  }
  if (input.titleNumber !== `${input.tbtId}-${input.sequence}`) {
    throw new Error('records: el numero de titulo es el TBT ID y el indice de esta tenencia.')
  }
  if (input.sequence === 1 && input.priorRecord) {
    throw new Error('records: la secuencia 1 no puede tener prior_record — es el origen.')
  }
  if (input.sequence > 1 && !input.priorRecord) {
    throw new Error('records: prior_record es obligatorio a partir de la secuencia 2.')
  }
  if (input.priorRecord) assertHash(input.priorRecord, 'prior_record')
  if ((input.event === 'creation') !== (input.sequence === 1)) {
    throw new Error('records: la creacion es la secuencia 1, y solo ella.')
  }
  if (!input.solanaSignature) throw new Error('records: falta la firma de Solana; el registro espera al movimiento.')
  if (!input.holdingAddress) throw new Error('records: falta la direccion de la tenencia.')
  if (!input.registrationRecord) throw new Error('records: falta registration_record.')

  if (input.value.kind !== VALUE_FOR[input.event]) {
    throw new Error(`records: un evento '${input.event}' lleva valor '${VALUE_FOR[input.event]}'.`)
  }
  let value: ProvenanceRecord['value']
  if (input.value.kind === 'creation' || input.value.kind === 'restoring') {
    value = { kind: input.value.kind }
  } else {
    const m = money(input.value, 'value')
    if (input.value.kind === 'gift' && m.amount_cents !== 0) throw new Error('records: un regalo vale cero.')
    value = { kind: input.value.kind, ...m }
  }

  let royalty: RecordRoyalty | null = null
  if (input.royalty) {
    if (input.sequence === 1) throw new Error('records: la regalia se bloquea en un cambio de dueño, nunca en la creacion.')
    if (input.royalty.type === 'percentage') {
      const bp = input.royalty.basis_points
      if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new Error('records: la regalia va en puntos basicos enteros.')
      royalty = { type: 'percentage', basis_points: bp }
    } else {
      royalty = { type: 'fixed', ...money(input.royalty, 'la regalia fija') }
    }
  }

  return {
    schema: RECORD_SCHEMA,
    type: 'provenance',
    tbt_id: input.tbtId,
    sequence: input.sequence,
    title_number: input.titleNumber,
    event: input.event,
    holder: holderOf(input.holder),
    holding_address: input.holdingAddress,
    value,
    ...(royalty ? { royalty } : {}),
    occurred_at: iso(input.occurredAt),
    solana_signature: input.solanaSignature,
    ...(input.priorRecord ? { prior_record: input.priorRecord } : {}),
    registration_record: arweaveId(input.registrationRecord),
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
 * La enmienda: un registro de registración completo que SUPERSEDE a otro, por
 * su ID desnudo (2.4).
 *
 * No reemplaza nada. El original sigue legible para siempre y la cadena entre
 * los dos es el historial de correcciones. El motivo es texto libre y SE
 * PUBLICA: cada reescritura es permanente, fechada, y lleva el motivo de una
 * persona en sus propias palabras.
 *
 * ADVERTENCIA — la clase `authorship` esta aceptada como tipo pero su FLUJO no
 * debe construirse: es la pregunta 30 para asesoria legal.
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
    // El unico limite duro del Item 5: si el hash cambia es OTRA obra.
    throw new Error('records: el hash de contenido no es enmendable. Otro archivo es otra obra y necesita otro TBT.')
  }

  return {
    ...registrationRecord(input),
    supersedes: arweaveId(input.supersedes),
    amendment_class: input.amendmentClass,
    amendment_reason: input.amendmentReason.trim(),
    decided_by: { initiator: input.decidedBy.initiator, approver: input.decidedBy.approver },
  }
}

export type AuthenticationInput = {
  tbtId: string
  titleNumber: string
  creator: { name: string; id: string; type: CreatorType }
  signatureHash?: string
  authenticatedAt: Date
  registrationRecord: string
  /** El numero del titulo vinculado que esta autenticacion supersede. */
  supersedes: string
}

export type AuthenticationRecord = {
  schema: typeof RECORD_SCHEMA
  type: 'authentication'
  tbt_id: string
  title_number: string
  creator: { name: string; id: string; type: CreatorType }
  signature_hash?: string
  authenticated_at: string
  registration_record: string
  supersedes: string
}

/**
 * La autenticacion (2.4): el creador autentica un titulo vinculado. No es un
 * cambio de manos, asi que el token no se mueve. Cierra Atlas F4.
 */
export function authenticationRecord(input: AuthenticationInput): AuthenticationRecord {
  if (!input.tbtId) throw new Error('records: falta tbt_id.')
  if (!input.titleNumber?.startsWith(`${input.tbtId}-`)) throw new Error('records: el numero de titulo es de esta obra.')
  if (!input.supersedes?.startsWith(`${input.tbtId}-`)) throw new Error('records: supersedes nombra el titulo vinculado de esta obra.')
  assertCreator(input.creator)
  if (input.signatureHash) assertHash(input.signatureHash, 'signature_hash')
  return {
    schema: RECORD_SCHEMA,
    type: 'authentication',
    tbt_id: input.tbtId,
    title_number: input.titleNumber,
    creator: { name: input.creator.name, id: input.creator.id, type: input.creator.type },
    ...(input.signatureHash ? { signature_hash: input.signatureHash } : {}),
    authenticated_at: iso(input.authenticatedAt),
    registration_record: arweaveId(input.registrationRecord),
    supersedes: input.supersedes,
  }
}

export type ProofInput = {
  tbtId: string
  recordHash: string
  recordId: string
  otsProof: Buffer
  blockHeight: number
  attestedAt: Date
}

export type ProofRecord = {
  schema: typeof RECORD_SCHEMA
  type: 'proof'
  tbt_id: string
  record_hash: string
  record_id: string
  ots_proof: string
  block_height: number
  attested_at: string
}

/**
 * La prueba (2.4, 6.3): cuando un ancla confirma, la prueba .ots completa se
 * publica junto al registro, para que el ancla se pueda comprobar cuando
 * tbt.cafe ya no exista. Una prueba no se ancla a su vez.
 */
export function proofRecord(input: ProofInput): ProofRecord {
  const hash = /^sha256:/.test(input.recordHash) ? input.recordHash : `sha256:${input.recordHash}`
  assertHash(hash, 'record_hash')
  if (!input.otsProof?.length) throw new Error('records: una prueba sin bytes no prueba nada.')
  if (!Number.isInteger(input.blockHeight) || input.blockHeight < 1) throw new Error('records: falta la altura del bloque.')
  return {
    schema: RECORD_SCHEMA,
    type: 'proof',
    tbt_id: input.tbtId,
    record_hash: hash,
    record_id: arweaveId(input.recordId),
    ots_proof: input.otsProof.toString('base64'),
    block_height: input.blockHeight,
    attested_at: iso(input.attestedAt),
  }
}
