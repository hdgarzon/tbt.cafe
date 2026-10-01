import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** El orden de escritura del Item 6. Guarda de las reglas que no se pueden violar. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const src = readFileSync(join(__dirname, '..', 'src/app/api/complete-tbt/route.ts'), 'utf8')
const nft = readFileSync(join(__dirname, '..', 'src/lib/solana/token.ts'), 'utf8')

const at = (needle: string) => src.indexOf(needle)

// ---- paso 3 antes del paso 4
{
  const publish = at('publishRecord(')
  const mint = at('await mintTitleToken(')
  ok('el registro se publica antes del mint', publish > 0 && mint > 0 && publish < mint,
     'la URI en cadena tiene que apuntar a algo que exista')
}

// ---- la URI se guarda ANTES de mintear
{
  const store = at('registration_record_uri: published.uri')
  const mint = at('await mintTitleToken(')
  ok('la URI se guarda antes del mint', store > 0 && store < mint,
     'sin eso, un reintento del mint no tiene a que agarrarse')
}

// ---- nunca republicar: si ya hay URI, se reutiliza
{
  ok('se reutiliza la URI ya guardada',
     src.includes('workWithCreator.registration_record_uri'),
     'dos registros sin supersedes es la forma que el modelo no expresa')
  ok('la publicación es condicional', /if \(!recordUri && workWithCreator\.content_hash\)/.test(src))
}

// ---- la cadena no puede tumbar la certificación
{
  const block = src.slice(at('let recordUri'), at('await mintTitleToken('))
  ok('la publicación va dentro de try/catch', block.includes('try {') && block.includes('catch'))
  ok('y el fallo solo se registra', block.includes('console.error'))
}

// ---- procedencia: origen sin prior_record, y después del mint
{
  // Chains 01 2.3: la creacion pasa por el publicador, con la firma del mint.
  const prov = at('publishProvenance(createAdminClient(), firstOwner.id, { solanaSignature: mintSignature })')
  const mint = at('await mintTitleToken(')
  ok('la procedencia se publica después del mint', prov > mint, 'lleva la firma de Solana dentro')
  ok('la secuencia 1 no lleva prior_record', !/sequence: 1[\s\S]{0,300}priorRecord/.test(src))
  ok('se guarda contra la fila de ownership_history', src.includes('record_uri: published.uri'))
}

// ---- Change A: el mint
{
  ok('el nombre en cadena es el TBT ID', nft.includes('name: work.tbtId'),
     'el título puede pasar el tope de 32 bytes con un acento')
  ok('el token no lleva regalía (Chains 01, 4.4: la lleva el registro)', !/Royalties|sellerFeeBasisPoints/.test(nft),
     'un número público que contradice work_commerce')
  ok('el mint exige la URI del registro', /mintTitleToken\([\s\S]{0,300}registrationRecordUri: string/.test(nft))
}

// ══ Item 7 — el orden de escritura de la transferencia ═══════════════════

const xfer = readFileSync(join(__dirname, '..', 'src/app/api/complete-transfer/route.ts'), 'utf8')

// ---- Change A: la transferencia ya no repunta el activo
{
  ok('no se re-sube metadata en una transferencia', !xfer.includes('processTransferOnChain('),
     'la URI del activo solo la repunta una enmienda')
  ok('no se reescribe token_uri', !/update\(\{ token_uri/.test(xfer),
     'cada transferencia borraba el enlace anterior')
  ok('el envoltorio muerto se fue', !existsSync(join(__dirname, '..', 'src/lib/solana/transfer.ts')))
}

// ---- la cadena de procedencia se encadena de verdad
{
  // Chains 01 2.3: el eslabon lo compone un solo sitio, desde la base.
  const pub = readFileSync(join(__dirname, '..', 'src/lib/chain/provenance-publish.ts'), 'utf8')
  ok('lleva el eslabón anterior', pub.includes('priorRecord = prior.record_hash') && pub.includes('priorRecord,'))
  ok('y el registro sellado', pub.includes('registrationRecord: work.registration_record_uri'))
  ok('el anterior se busca por secuencia', xfer.includes('sequenceNumber - 1'))
}

// ---- una transferencia no firma nada
{
  const pub2 = readFileSync(join(__dirname, '..', 'src/lib/chain/provenance-publish.ts'), 'utf8')
  // Chains 01 4.5 reemplaza la regla anterior: el token se mueve, y el eslabon
  // lleva la firma de ESE movimiento, nunca otro identificador.
  ok('la procedencia de transferencia lleva la firma del movimiento',
     /if \(moveSignature\) \{/.test(xfer) && pub2.includes('row.token_move_signature'))
  ok('el token se mueve antes del eslabon', xfer.indexOf('await moveTokenForOwnership(') > -1 && xfer.indexOf('await moveTokenForOwnership(') < xfer.indexOf('publishProvenance('))
  ok('sin movimiento, el eslabon espera', /if \(moveSignature\) \{/.test(xfer) && pub2.includes("reason: 'no_signature'"))
}

// ---- y la firma que SÍ existe es una firma
{
  ok('el mint devuelve la firma de la transacción', nft.includes('signature: signatureOf(result)'))
  ok('y la procedencia la recibe', src.includes('solanaSignature: mintSignature'))
  ok('la certificación ya no manda la dirección del mint',
     !src.includes('solanaSignature: mintAddress'),
     'una direccion de cuenta en un campo que significa firma')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
