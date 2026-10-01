import { readFileSync } from 'fs'
import { join } from 'path'
import { canonicalize, recordHash, RECORD_SCHEMA } from '../src/lib/chain/serialize'
import {
  registrationRecord, provenanceRecord, amendmentRecord, authenticationRecord, proofRecord,
  FORBIDDEN_IN_REGISTRATION, RECORD_KINDS, arweaveId, signatureHash,
} from '../src/lib/chain/records'

/**
 * Los registros de Arweave en su forma final — Chain Spec 01 Item 4, y Chains 01
 * Stage 2, que manda donde difieren. Prueba primero.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'no lanzo') } catch { ok(label, true) }
}

const AR_REG = '3Bq9xY7kLmN2pQ4rS6tU8vW0xZ1aB3cD5eF7gH9iJ0k'
const AR_IMG = '8Kf2QpXa1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ'
const HASH_B = 'sha256:' + 'b'.repeat(64)

const reg = {
  tbtId: 'TBT-A7K2M9',
  sequence: 1,
  contentHash: 'sha256:9f2c3d4e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f',
  creator: { name: 'Sara Alarcón', id: 'cr_7k2m9q4x8z', type: 'individual' as const },
  work: { title: 'Nocturno en Medellín', year: 2026, category: 'painting',
          technique: 'oil on canvas', originality: 'original' as const },
  context: { statement: 'Pintado de noche.', city: 'Medellín', country: 'CO' },
  series: 'Nocturnos',
  sealedAt: new Date(Date.UTC(2026, 7, 26, 14, 3, 22)),
}

// ---- 2.1 a: identificadores de Arweave desnudos
ok('un ID desnudo pasa igual', arweaveId(AR_REG) === AR_REG)
ok('una URL de pasarela se reduce al ID', arweaveId(`https://arweave.net/${AR_REG}`) === AR_REG)
ok('tambien la de devnet', arweaveId(`https://devnet.irys.xyz/${AR_REG}`) === AR_REG)
throws('lo que no es un ID de Arweave lanza', () => arweaveId('ar://8Kf2'))

// ---- 2.1 d: la lista de clases en un solo sitio
ok('las cinco clases de registro', ['registration', 'provenance', 'amendment', 'authentication', 'proof'].every((k) => (RECORD_KINDS as readonly string[]).includes(k)))

// ---- 2.2 registración
{
  const r = registrationRecord(reg)
  ok('schema y tipo', r.schema === RECORD_SCHEMA && r.type === 'registration')
  ok('sigue siendo v1: nada se subio nunca a mainnet', RECORD_SCHEMA === 'tbt.record.v1')
  ok('lleva el hash de contenido', r.content_hash === reg.contentHash)
  ok('fecha en el formato del spec', canonicalize(r).includes('"2026-08-26T14:03:22Z"'))
  ok('hash reproducible', recordHash(r) === recordHash(registrationRecord(reg)))
  ok('sin campos opcionales no aparecen', !('declared_value' in r) && !('signature_hash' in r) && !('recording_hash' in r) && !('asset_links' in r))
}
throws('el creador no puede ir con el seudonimo calculable', () => registrationRecord({ ...reg, creator: { ...reg.creator, id: 'cr_8812ab34cd56' } }))
{
  const r = registrationRecord({
    ...reg,
    image: { uri: `https://arweave.net/${AR_IMG}`, hash: HASH_B, kind: 'reduced' },
    declaredValue: { amount_cents: 120000, currency: 'USD' },
    signatureHash: 'sha256:' + 'c'.repeat(64),
    recordingHash: 'sha256:' + 'd'.repeat(64),
    recordingKind: 'audio',
    assetLinks: ['https://example.com/b', 'https://example.com/a'],
  })
  ok('la imagen va por ID desnudo', r.image === AR_IMG && r.image_kind === 'reduced')
  ok('el valor declarado es dinero', r.declared_value?.amount_cents === 120000 && r.declared_value?.currency === 'USD')
  ok('la huella de la firma', r.signature_hash === 'sha256:' + 'c'.repeat(64))
  ok('la grabacion: huella y clase', r.recording_hash === 'sha256:' + 'd'.repeat(64) && r.recording_kind === 'audio')
  ok('los enlaces en su orden', r.asset_links?.[0] === 'https://example.com/b' && r.asset_links?.[1] === 'https://example.com/a')
}
throws('el dinero en flotante lanza', () => registrationRecord({ ...reg, declaredValue: { amount_cents: 12.5, currency: 'USD' } }))
throws('la moneda va en ISO', () => registrationRecord({ ...reg, declaredValue: { amount_cents: 100, currency: 'usd' } }))
throws('la grabacion sin clase lanza', () => registrationRecord({ ...reg, recordingHash: 'sha256:' + 'd'.repeat(64) }))

// ---- LA GUARDA: lo ausente por diseño sigue ausente
{
  ok('price deja la lista: declared_value es un campo con nombre', !(FORBIDDEN_IN_REGISTRATION as readonly string[]).includes('price'))
  ok('la regalia sigue en ella', (FORBIDDEN_IN_REGISTRATION as readonly string[]).includes('royalty'))
  const sucio = { ...reg, price: 12000, royalty: { type: 'fixed', value: 200000 },
                  transferCode: 'ABCD-1234', owner: 'H. Garzón',
                  coordinates: { lat: 6.24, lng: -75.58 },
                  phone: '+573001112233', email: 'x@example.com' } as never
  const serial = canonicalize(registrationRecord(sucio))
  for (let i = 0; i < FORBIDDEN_IN_REGISTRATION.length; i++) {
    const campo = FORBIDDEN_IN_REGISTRATION[i]
    ok(`ausente por diseño · ${campo}`, !serial.includes(`"${campo}"`))
  }
  ok('ningun valor prohibido se cuela', !/12000|200000|ABCD-1234|573001112233|x@example\.com|6\.24/.test(serial), serial.slice(0, 120))
}

// ---- secuencia
throws('rechaza secuencia 0', () => registrationRecord({ ...reg, sequence: 0 }))
throws('rechaza secuencia decimal', () => registrationRecord({ ...reg, sequence: 1.5 }))
throws('exige hash de contenido', () => registrationRecord({ ...reg, contentHash: '' }))
throws('exige el prefijo sha256:', () => registrationRecord({ ...reg, contentHash: 'deadbeef' }))

// ---- 2.3 procedencia
const HOLDING = 'F9ieqDeu9tk2eBeMLXdRdtyagHVhdR9uNbqqJBjPgg3q'
const prov = {
  tbtId: 'TBT-A7K2M9', sequence: 3, titleNumber: 'TBT-A7K2M9-3', event: 'sale' as const,
  holder: { privateCollector: 48213 },
  holdingAddress: HOLDING,
  value: { kind: 'sale' as const, amount_cents: 450000, currency: 'USD' },
  occurredAt: new Date(Date.UTC(2026, 8, 14, 9, 11, 4)),
  solanaSignature: '5xQabcSig',
  priorRecord: HASH_B,
  registrationRecord: `https://arweave.net/${AR_REG}`,
}
{
  const p = provenanceRecord(prov)
  ok('procedencia tipada', p.type === 'provenance' && p.event === 'sale')
  ok('el numero de titulo', p.title_number === 'TBT-A7K2M9-3')
  ok('el titular sin nombre va como codigo', p.holder.private_collector === '48213' && !('name' in p.holder))
  ok('la direccion de la tenencia', p.holding_address === HOLDING)
  ok('el valor: precio pagado', p.value.kind === 'sale' && p.value.amount_cents === 450000 && p.value.currency === 'USD')
  ok('sin from', !('from' in p) && !canonicalize(p).includes('"from"'))
  ok('sin regalia cuando no se bloquea aqui', !('royalty' in p))
  ok('enlaza hacia atras por hash', p.prior_record === HASH_B)
  ok('la registracion por ID desnudo', p.registration_record === AR_REG)
  ok('la firma de solana', p.solana_signature === '5xQabcSig')

  const nombrado = provenanceRecord({ ...prov, holder: { name: 'H. Garzón' } })
  ok('el titular nombrado va con su nombre', nombrado.holder.name === 'H. Garzón' && !('private_collector' in nombrado.holder))

  const regalo = provenanceRecord({ ...prov, event: 'gift', value: { kind: 'gift', amount_cents: 0, currency: 'USD' } })
  ok('un regalo vale cero', regalo.value.kind === 'gift' && regalo.value.amount_cents === 0)

  const primera = provenanceRecord({ ...prov, sequence: 1, titleNumber: 'TBT-A7K2M9-1', event: 'creation', value: { kind: 'creation' }, holder: { name: 'Sara Alarcón' }, priorRecord: undefined })
  ok('la creacion no lleva importe', primera.value.kind === 'creation' && !('amount_cents' in primera.value))
  ok('sin prior_record en la secuencia 1', !('prior_record' in primera))

  const bloqueo = provenanceRecord({ ...prov, sequence: 2, titleNumber: 'TBT-A7K2M9-2', royalty: { type: 'percentage', basis_points: 1000 } })
  ok('la regalia, en el registro donde se bloquea', bloqueo.royalty?.type === 'percentage' && (bloqueo.royalty as { basis_points: number }).basis_points === 1000)
  const fija = provenanceRecord({ ...prov, sequence: 2, titleNumber: 'TBT-A7K2M9-2', royalty: { type: 'fixed', amount_cents: 5000, currency: 'USD' } })
  ok('una regalia fija es dinero', fija.royalty?.type === 'fixed' && (fija.royalty as { amount_cents: number }).amount_cents === 5000)
}
throws('nombre y codigo a la vez lanza', () => provenanceRecord({ ...prov, holder: { name: 'X', privateCollector: 48213 } as never }))
throws('un codigo que no es de cinco cifras lanza', () => provenanceRecord({ ...prov, holder: { privateCollector: 4821 } }))
throws('el numero de titulo debe ser el de esta secuencia', () => provenanceRecord({ ...prov, titleNumber: 'TBT-A7K2M9-2' }))
throws('la firma de solana es obligatoria', () => provenanceRecord({ ...prov, solanaSignature: '' }))
throws('el valor debe ir con su evento', () => provenanceRecord({ ...prov, event: 'gift' }))
throws('una transferencia lleva valor declarado', () => provenanceRecord({ ...prov, event: 'transfer' }))
throws('la creacion no lleva regalia', () => provenanceRecord({ ...prov, sequence: 1, titleNumber: 'TBT-A7K2M9-1', event: 'creation', value: { kind: 'creation' }, priorRecord: undefined, royalty: { type: 'percentage', basis_points: 1000 } }))
throws('prior_record obligatorio si sequence > 1', () => provenanceRecord({ ...prov, priorRecord: undefined }))
throws('rechaza evento desconocido', () => provenanceRecord({ ...prov, event: 'loan' as never }))

// ---- enmienda: supersedes desnudo
{
  const a = amendmentRecord({
    ...reg, sequence: 2,
    supersedes: `https://arweave.net/${AR_REG}`,
    amendmentClass: 'minor',
    amendmentReason: 'El titulo estaba mal escrito.',
    decidedBy: { initiator: 'adm_04', approver: 'adm_01' },
  })
  ok('la enmienda es un registro completo', a.type === 'registration' && a.content_hash === reg.contentHash)
  ok('supersedes es un ID desnudo', a.supersedes === AR_REG)
}
throws('la enmienda exige motivo', () => amendmentRecord({
  ...reg, sequence: 2, supersedes: AR_REG, amendmentClass: 'minor',
  amendmentReason: '   ', decidedBy: { initiator: 'a', approver: 'b' } }))
throws('la enmienda exige dos personas distintas', () => amendmentRecord({
  ...reg, sequence: 2, supersedes: AR_REG, amendmentClass: 'minor',
  amendmentReason: 'x', decidedBy: { initiator: 'a', approver: 'a' } }))

// ---- 2.4 autenticacion y prueba
{
  const a = authenticationRecord({
    tbtId: 'TBT-A7K2M9', titleNumber: 'TBT-A7K2M9-2',
    creator: reg.creator, signatureHash: 'sha256:' + 'c'.repeat(64),
    authenticatedAt: new Date(Date.UTC(2026, 9, 1)),
    registrationRecord: AR_REG, supersedes: 'TBT-A7K2M9-1',
  })
  ok('autenticacion tipada', a.type === 'authentication' && a.title_number === 'TBT-A7K2M9-2' && a.supersedes === 'TBT-A7K2M9-1')
  ok('autenticacion: registracion desnuda', a.registration_record === AR_REG)

  const pr = proofRecord({
    tbtId: 'TBT-A7K2M9', recordHash: HASH_B, recordId: `https://arweave.net/${AR_REG}`,
    otsProof: Buffer.from('proof-bytes'), blockHeight: 912345, attestedAt: new Date(Date.UTC(2026, 9, 1)),
  })
  ok('prueba tipada', pr.type === 'proof' && pr.record_id === AR_REG && pr.block_height === 912345)
  ok('la prueba entera en base64', pr.ots_proof === Buffer.from('proof-bytes').toString('base64'))
}

// ---- la huella de la firma
{
  const strokes = [[[12.3, 40.1], [13, 41.5]], [[100.2, 20]]]
  const h = signatureHash(strokes)
  ok('la firma tiene huella sha256', /^sha256:[0-9a-f]{64}$/.test(h))
  ok('es estable', h === signatureHash(JSON.parse(JSON.stringify(strokes))))
  ok('cambia con un trazo', h !== signatureHash([[[12.3, 40.1]]]))
}

// ---- los sitios que publican
{
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')
  const ar = read('src/lib/chain/arweave.ts')
  ok('una prueba no se ancla', /record\.type !== 'proof'/.test(ar))
  ok('anchorRecord toma la clase de la lista', /anchorRecord\(hash, record\.type as RecordKind/.test(ar))
  const pub = read('src/lib/chain/provenance-publish.ts')
  ok('la procedencia se compone en un solo sitio', /export async function publishProvenance\(/.test(pub))
  ok('la regalia solo donde se bloqueo', /royalty_locked_by === row\.id/.test(pub))
  ok('una transferencia con valor es transfer, no sale', /declared: 'transfer'/.test(pub))
  const tbt = read('src/app/api/complete-tbt/route.ts')
  ok('la creacion pasa por el publicador', /publishProvenance\(/.test(tbt))
  ok('el creador va con su codigo', /creatorCodeFor\(/.test(tbt) && !/pseudonymFor\(/.test(tbt))
  const xfer = read('src/app/api/complete-transfer/route.ts')
  ok('la transferencia pasa por el publicador', /publishProvenance\(/.test(xfer) && !/provenanceRecord\(\{/.test(xfer))
  ok('la fila del historial nombra su transferencia', /transfer_id: transfer\.id/.test(xfer))
  ok('una restitucion tambien publica', /publishProvenance\(/.test(read('src/lib/restoring.ts')))
}

console.log(bad === 0 ? '\nTodo correcto.' : `\n${bad} fallo(s).`)
process.exit(bad === 0 ? 0 : 1)
