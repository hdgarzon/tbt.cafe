import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** El orden de escritura del Item 6. Guarda de las reglas que no se pueden violar. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const src = readFileSync(join(__dirname, '..', 'src/app/api/complete-tbt/route.ts'), 'utf8')
const nft = readFileSync(join(__dirname, '..', 'src/lib/solana/nft.ts'), 'utf8')

const at = (needle: string) => src.indexOf(needle)

// ---- paso 3 antes del paso 4
{
  const publish = at('publishRecord(')
  const mint = at('await mintTBTNft(')
  ok('el registro se publica antes del mint', publish > 0 && mint > 0 && publish < mint,
     'la URI en cadena tiene que apuntar a algo que exista')
}

// ---- la URI se guarda ANTES de mintear
{
  const store = at('registration_record_uri: published.uri')
  const mint = at('await mintTBTNft(')
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
  const block = src.slice(at('let recordUri'), at('await mintTBTNft('))
  ok('la publicación va dentro de try/catch', block.includes('try {') && block.includes('catch'))
  ok('y el fallo solo se registra', block.includes('console.error'))
}

// ---- procedencia: origen sin prior_record, y después del mint
{
  const prov = at("event: 'creation'")
  const mint = at('await mintTBTNft(')
  ok('la procedencia se publica después del mint', prov > mint, 'lleva la firma de Solana dentro')
  ok('la secuencia 1 no lleva prior_record', !/sequence: 1[\s\S]{0,300}priorRecord/.test(src))
  ok('se guarda contra la fila de ownership_history', src.includes('record_uri: published.uri'))
}

// ---- Change A: el mint
{
  ok('el nombre en cadena es el TBT ID', nft.includes('name: work.tbtId'),
     'el título puede pasar el tope de 32 bytes con un acento')
  ok('la regalía en cadena es cero', nft.includes('sellerFeeBasisPoints: 0'),
     'un número público que contradice work_commerce')
  ok('ya no se fija en 500', !nft.includes('sellerFeeBasisPoints: 500'))
  ok('el mint acepta la URI del registro', /mintTBTNft\([\s\S]{0,900}registrationRecordUri\?: string/.test(nft))
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
  ok('lleva el eslabón anterior', xfer.includes('priorRecord: priorLink.record_hash'))
  ok('y el registro sellado', xfer.includes('registrationRecord: chainSource.registration_record_uri'))
  ok('el anterior se busca por secuencia', xfer.includes('sequenceNumber - 1'))
}

// ---- una transferencia no firma nada
{
  const block = xfer.slice(xfer.indexOf('provenanceRecord({'), xfer.indexOf('publishRecord') + 4000)
  ok('la procedencia de transferencia no lleva firma', !block.includes('solanaSignature'),
     'la propiedad se mueve en la base, no en la cadena')
}

// ---- y la firma que SÍ existe es una firma
{
  const nftSrc = readFileSync(join(__dirname, '..', 'src/lib/solana/nft.ts'), 'utf8')
  ok('el mint devuelve la firma de la transacción', nftSrc.includes('signature: response.signature'))
  ok('la certificación ya no manda la dirección del mint',
     !src.includes('solanaSignature: mintAddress'),
     'una direccion de cuenta en un campo que significa firma')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
