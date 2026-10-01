import { canonicalize } from '../src/lib/chain/serialize'
import { registrationRecord, provenanceRecord, amendmentRecord, authenticationRecord, proofRecord } from '../src/lib/chain/records'
import { ARWEAVE_GATEWAYS } from '../src/lib/chain/gateways'

/**
 * Chains 01, 2.1 a — ningun campo de un registro lleva una pasarela.
 *
 * `https://arweave.net/<id>` hornea una pasarela en un dato permanente. Los
 * registros se citan por ID desnudo; solo la URI del token, que es un puntero
 * movible, puede ser una URL. Se alimentan los constructores con URLs de todas
 * las pasarelas y se comprueba que ninguna sobrevive.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const ID = '3Bq9xY7kLmN2pQ4rS6tU8vW0xZ1aB3cD5eF7gH9iJ0k'
const hosts = ARWEAVE_GATEWAYS.map((g) => g.replace(/^https:\/\//, '')).concat(['devnet.irys.xyz', 'gateway.irys.xyz'])
const GATEWAY_URL = new RegExp(`https://(${hosts.map((h) => h.replace(/\./g, '\\.')).join('|')})`)

const urls = ARWEAVE_GATEWAYS.map((g) => `${g}/${ID}`).concat([`https://devnet.irys.xyz/${ID}`])
const reg = {
  tbtId: 'RRO5501', sequence: 1, contentHash: 'sha256:' + 'a'.repeat(64),
  creator: { name: 'Sara Alarcón', id: 'cr_7k2m9q4x8z', type: 'individual' as const },
  work: { title: 'Nocturno', year: 2026, originality: 'original' as const },
  sealedAt: new Date(Date.UTC(2026, 7, 26)),
}

for (let i = 0; i < urls.length; i++) {
  const url = urls[i]
  const records: Array<[string, unknown]> = [
    ['registration', registrationRecord({ ...reg, image: { uri: url, hash: 'sha256:' + 'b'.repeat(64), kind: 'full' } })],
    ['provenance', provenanceRecord({
      tbtId: 'RRO5501', sequence: 1, titleNumber: 'RRO5501-1', event: 'creation', holder: { name: 'Sara' },
      holdingAddress: 'F9ieqDeu9tk2eBeMLXdRdtyagHVhdR9uNbqqJBjPgg3q', value: { kind: 'creation' },
      occurredAt: new Date(Date.UTC(2026, 7, 26)), solanaSignature: 'sig', registrationRecord: url,
    })],
    ['amendment', amendmentRecord({ ...reg, sequence: 2, supersedes: url, amendmentClass: 'minor', amendmentReason: 'x', decidedBy: { initiator: 'a', approver: 'b' } })],
    ['authentication', authenticationRecord({ tbtId: 'RRO5501', titleNumber: 'RRO5501-2', creator: reg.creator, authenticatedAt: new Date(Date.UTC(2026, 9, 1)), registrationRecord: url, supersedes: 'RRO5501-1' })],
    ['proof', proofRecord({ tbtId: 'RRO5501', recordHash: 'sha256:' + 'c'.repeat(64), recordId: url, otsProof: Buffer.from('x'), blockHeight: 1, attestedAt: new Date(Date.UTC(2026, 9, 1)) })],
  ]
  for (let j = 0; j < records.length; j++) {
    const serial = canonicalize(records[j][1])
    ok(`${records[j][0]} · ${url.split('/')[2]}`, !GATEWAY_URL.test(serial), serial.slice(0, 160))
  }
}

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
