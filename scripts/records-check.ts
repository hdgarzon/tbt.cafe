import { canonicalize, recordHash, RECORD_SCHEMA } from '../src/lib/chain/serialize'
import {
  registrationRecord, provenanceRecord, amendmentRecord,
  FORBIDDEN_IN_REGISTRATION,
} from '../src/lib/chain/records'

/** Los tres registros de Arweave — Chain Spec 01, Item 4. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const throws = (label: string, fn: () => unknown) => {
  try { fn(); ok(label, false, 'no lanzo') } catch { ok(label, true) }
}

const reg = {
  tbtId: 'TBT-A7K2M9',
  sequence: 1,
  contentHash: 'sha256:9f2c3d4e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f',
  creator: { name: 'Sara Alarcón', id: 'cr_8812', type: 'individual' as const },
  work: { title: 'Nocturno en Medellín', year: 2026, category: 'painting',
          technique: 'oil on canvas', originality: 'original' as const },
  context: { statement: 'Pintado de noche.', city: 'Medellín', country: 'CO' },
  series: 'Nocturnos',
  sealedAt: new Date(Date.UTC(2026, 7, 26, 14, 3, 22)),
}

// ---- registro de registración
{
  const r = registrationRecord(reg)
  ok('schema y tipo', r.schema === RECORD_SCHEMA && r.type === 'registration')
  ok('lleva el hash de contenido', r.content_hash === reg.contentHash)
  ok('fecha en el formato del spec', canonicalize(r).includes('"2026-08-26T14:03:22Z"'))
  ok('hash reproducible', recordHash(r) === recordHash(registrationRecord(reg)))
}

// ---- LA GUARDA: lo ausente por diseño sigue ausente
{
  // Se pasa un objeto contaminado con todo lo que el spec prohibe. Si alguien
  // ensancha el constructor manana, esto lo atrapa antes que Arweave, que es
  // donde ya no habria vuelta atras.
  const sucio = { ...reg, price: 12000, royalty: { type: 'fixed', value: 200000 },
                  transferCode: 'ABCD-1234', owner: 'H. Garzón',
                  coordinates: { lat: 6.24, lng: -75.58 },
                  phone: '+573001112233', email: 'x@example.com' } as never
  const serial = canonicalize(registrationRecord(sucio))
  for (const campo of FORBIDDEN_IN_REGISTRATION) {
    ok(`ausente por diseño · ${campo}`, !serial.includes(`"${campo}"`))
  }
  ok('ningun valor prohibido se cuela', !/12000|200000|ABCD-1234|573001112233|x@example\.com|6\.24/.test(serial), serial.slice(0, 120))
}

// ---- secuencia
throws('rechaza secuencia 0', () => registrationRecord({ ...reg, sequence: 0 }))
throws('rechaza secuencia negativa', () => registrationRecord({ ...reg, sequence: -1 }))
throws('rechaza secuencia decimal', () => registrationRecord({ ...reg, sequence: 1.5 }))
throws('exige hash de contenido', () => registrationRecord({ ...reg, contentHash: '' }))
throws('exige el prefijo sha256:', () => registrationRecord({ ...reg, contentHash: 'deadbeef' }))

// ---- procedencia
const prov = {
  tbtId: 'TBT-A7K2M9', sequence: 3, event: 'sale' as const,
  from: { name: 'Sara Alarcón', id: 'cr_8812' },
  to: { name: 'H. Garzón', id: 'co_4471' },
  occurredAt: new Date(Date.UTC(2026, 8, 14, 9, 11, 4)),
  solanaSignature: '5xQabc',
  priorRecord: 'ar://8Kf2',
  registrationRecord: 'ar://3Bq9',
}
{
  const p = provenanceRecord(prov)
  ok('procedencia tipada', p.type === 'provenance' && p.event === 'sale')
  ok('enlaza hacia atras', p.prior_record === 'ar://8Kf2')
  ok('nombra la cabeza de registración', p.registration_record === 'ar://3Bq9')

  const primera = provenanceRecord({ ...prov, sequence: 1, event: 'creation', priorRecord: undefined })
  ok('sin prior_record en la secuencia 1', !('prior_record' in primera))
  ok('sin prior_record no serializa la clave', !canonicalize(primera).includes('prior_record'))
}
throws('prior_record obligatorio si sequence > 1', () => provenanceRecord({ ...prov, priorRecord: undefined }))
throws('prior_record prohibido en la secuencia 1', () => provenanceRecord({ ...prov, sequence: 1, priorRecord: 'ar://x' }))
throws('rechaza evento desconocido', () => provenanceRecord({ ...prov, event: 'loan' as never }))

// ---- enmienda
{
  const a = amendmentRecord({
    ...reg, sequence: 2,
    supersedes: 'ar://3Bq9',
    amendmentClass: 'minor',
    amendmentReason: 'El titulo estaba mal escrito.',
    decidedBy: { initiator: 'adm_04', approver: 'adm_01' },
  })
  ok('la enmienda es un registro completo', a.type === 'registration' && a.content_hash === reg.contentHash)
  ok('nombra a quien supersede', a.supersedes === 'ar://3Bq9')
  ok('clase y motivo publicados', a.amendment_class === 'minor' && a.amendment_reason.length > 0)
  ok('dos personas nombradas', a.decided_by.initiator === 'adm_04' && a.decided_by.approver === 'adm_01')
}
throws('la enmienda exige motivo', () => amendmentRecord({
  ...reg, sequence: 2, supersedes: 'ar://x', amendmentClass: 'minor',
  amendmentReason: '   ', decidedBy: { initiator: 'a', approver: 'b' } }))
throws('la enmienda exige dos personas distintas', () => amendmentRecord({
  ...reg, sequence: 2, supersedes: 'ar://x', amendmentClass: 'minor',
  amendmentReason: 'x', decidedBy: { initiator: 'a', approver: 'a' } }))
throws('el hash de contenido no es enmendable', () => amendmentRecord({
  ...reg, sequence: 2, contentHash: 'sha256:' + 'a'.repeat(64),
  supersedes: 'ar://x', amendmentClass: 'minor', amendmentReason: 'x',
  decidedBy: { initiator: 'a', approver: 'b' }, priorContentHash: reg.contentHash }))

console.log(bad === 0 ? '\nTodo correcto.' : `\n${bad} fallo(s).`)
process.exit(bad === 0 ? 0 : 1)
