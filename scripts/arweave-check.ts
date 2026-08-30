import { readFileSync } from 'fs'
import { join } from 'path'
import { canonicalize, recordHash } from '../src/lib/chain/serialize'
import { registrationRecord } from '../src/lib/chain/records'
import { recordFileFor, RECORD_TAGS } from '../src/lib/chain/arweave'

/** Lo que se publica tiene que ser lo que se hashea. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const record = registrationRecord({
  tbtId: 'TBT-2026-ABC123',
  sequence: 1,
  contentHash: 'sha256:9f2c3d4e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f',
  creator: { name: 'Sara Alarcón', id: 'cr_8812', type: 'individual' },
  work: {
    title: 'Nocturno en Medellín', year: 2026, category: 'painting',
    technique: 'oil on canvas', originality: 'original',
  },
  context: { statement: 'Pintado de noche.', city: 'Medellín', country: 'CO' },
  sealedAt: new Date(Date.UTC(2026, 7, 26, 14, 3, 22)),
})

// ---- LO ESENCIAL: los bytes que suben son los que se hashean
{
  const file = recordFileFor(record)
  const canonical = canonicalize(record)

  ok('el archivo lleva la forma canónica exacta', file.buffer.toString('utf8') === canonical)
  ok('y no una reserialización', file.buffer.toString('utf8') !== JSON.stringify(record))
  ok('se declara como json', file.contentType === 'application/json')
}

// ---- el nombre identifica el registro sin abrirlo
{
  const file = recordFileFor(record)
  ok('el nombre lleva el TBT', file.fileName.includes('TBT-2026-ABC123'))
  ok('y el tipo de registro', file.fileName.includes('registration'))
}

// ---- las etiquetas dejan el registro buscable en Arweave
{
  const file = recordFileFor(record)
  const tags = Object.fromEntries((file.tags ?? []).map((t) => [t.name, t.value]))
  ok('etiqueta de aplicación', tags[RECORD_TAGS.app] === 'tbt.cafe')
  ok('etiqueta de esquema', tags[RECORD_TAGS.schema] === record.schema)
  ok('etiqueta de tipo', tags[RECORD_TAGS.type] === 'registration')
  ok('etiqueta con el TBT', tags[RECORD_TAGS.tbtId] === 'TBT-2026-ABC123')
  ok('etiqueta con el hash del registro', tags[RECORD_TAGS.hash] === recordHash(record))
  ok('Content-Type para las pasarelas', tags['Content-Type'] === 'application/json')
}

// ---- el hash es reproducible desde lo publicado
{
  const file = recordFileFor(record)
  const republished = JSON.parse(file.buffer.toString('utf8'))
  ok('rehashear lo subido da lo mismo', recordHash(republished) === recordHash(record))
}

// ---- la URI tiene que resolver en la red donde se publico
{
  const src = readFileSync(join(__dirname, '..', 'src/lib/chain/arweave.ts'), 'utf8')
  // El driver devuelve siempre arweave.net, que en devnet es un 404. Se
  // comprobo subiendo un registro real y pidiendolo por las tres pasarelas.
  ok('la URI se ajusta a la red', src.includes('gatewayUri'))
  ok('devnet apunta a la pasarela de Irys', src.includes('devnet.irys.xyz'))
  ok('mainnet apunta a Arweave', src.includes('https://arweave.net/'))
}

// ---- LA GUARDA: nunca uploadJson
{
  const src = readFileSync(join(__dirname, '..', 'src/lib/chain/arweave.ts'), 'utf8')
  // Se afirma sobre la LLAMADA: el comentario del modulo nombra el metodo
  // justamente para explicar por que no se usa.
  ok('no se sube con uploadJson', !src.includes('uploadJson('))
  ok('se sube el archivo construido a mano', src.includes('.upload('))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
