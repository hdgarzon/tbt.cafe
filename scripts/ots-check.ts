import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { toBytea, fromBytea } from '../src/lib/chain/ots'

/** El ancla de Bitcoin. Lo comprobable sin esperar horas a un bloque. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')
const ots = read('src/lib/chain/ots.ts')
const ar = read('src/lib/chain/arweave.ts')
const cron = read('src/app/api/cron/anchor-upgrade/route.ts')

// ---- LA TRAMPA QUE COSTÓ UNA EJECUCIÓN
{
  // `stamp` y compañía son métodos que usan `this` por dentro. Desestructurarlos
  // compila y falla al ejecutar con "reading 'makeMerkleTree'".
  ok('no se desestructuran las funciones de la librería',
     !/import\s*\{[^}]*\b(stamp|upgrade|verify)\s+as\b/.test(ots),
     'perderían el `this` y fallarían solo en ejecución')
  ok('se llaman sobre el objeto', /OpenTimestamps\.(stamp|upgrade|verify)\(/.test(ots))
}

// ---- los exports que el spec pide
{
  ok('exporta stamp', /export async function stamp\(hashHex: string\)/.test(ots))
  ok('exporta upgrade', /export async function upgrade\(proof: Buffer\)/.test(ots))
  ok('exporta verify', /export async function verify\(proof: Buffer, hashHex: string\)/.test(ots))
  ok('UpgradeResult lleva blockHeight opcional', /UpgradeResult = \{[^}]*blockHeight\?: number/.test(ots))
  ok('VerifyResult lleva altura y sello', /VerifyResult = \{ blockHeight: number; timestamp: string \}/.test(ots))
}

// ---- anclar no puede tumbar nada
{
  ok('anchorRecord no lanza', /export async function anchorRecord[\s\S]{0,1200}try \{[\s\S]{0,1200}catch/.test(ots))
  ok('una clave duplicada no es un fallo', ots.includes("error.code !== '23505'"))
}

// ---- todo lo publicado se ancla, en un solo sitio
{
  ok('publishRecord ancla', ar.includes('await anchorRecord('))
  ok('y distingue el tipo de registro', /record\.type === 'registration'/.test(ar))
}

// ---- el cron
{
  ok('existe la ruta', existsSync(join(__dirname, '..', 'src/app/api/cron/anchor-upgrade/route.ts')))
  ok('solo mira lo pendiente', cron.includes("eq('status', 'pending')"))
  ok('declara su límite de tiempo', cron.includes('maxDuration'))
  // Sin esto el build la ejecuta una vez y congela la respuesta: cada disparo
  // horario devolveria ese resultado vacio.
  ok('es dinámica y no se prerenderiza', cron.includes("dynamic = 'force-dynamic'"))
  ok('comprueba el secreto si existe', cron.includes('CRON_SECRET'))
  ok('confirma solo con altura de bloque', /result\.upgraded && result\.blockHeight/.test(cron),
     'un cambio sin bloque sigue siendo pendiente')
  ok('guarda la prueba avanzada aunque siga pendiente',
     /result\.upgraded \? \{ ots_proof: toBytea\(result\.proof\) \}/.test(cron),
     'y convertida: esta aserción fijaba la forma que guardaba el Buffer crudo')

  const vercel = JSON.parse(read('vercel.json'))
  const job = (vercel.crons ?? [])[0]
  ok('el cron está declarado', job?.path === '/api/cron/anchor-upgrade')
  ok('una vez al día', /^\d+ \d+ \* \* \*$/.test(job?.schedule ?? ''),
     `'${job?.schedule}' — una cuenta Hobby RECHAZA EL DESPLIEGUE ENTERO si corre más veces al día`)
}

// ---- la prueba se guarda como BYTES, no como un Buffer serializado
//
// `ots_proof: proof` con un Buffer parece obvio y no lo es: el cliente lo pasa
// por JSON.stringify y la columna acababa con `{"type":"Buffer","data":[...]}`.
// Al leerla, `deserialize` lanzaba BadMagicError con los primeros numeros de ese
// array — que parecian una cabecera rota y eran la prueba envuelta. Ningun ancla
// podia confirmarse: las cuatro que habia estuvieron dos dias sin poder.
{
  const proof = Buffer.from([0x00, 0x4f, 0x70, 0x65, 0x6e, 0xff, 0x00, 0x2a])

  ok('ida y vuelta devuelve los mismos bytes', fromBytea(toBytea(proof)).equals(proof))
  ok('se escribe en el formato que Postgres entiende', toBytea(proof).startsWith('\\x'))
  ok('y se lee aunque venga sin el prefijo', fromBytea(proof.toString('hex')).equals(proof))
  ok('un Buffer serializado NO es la prueba',
     !Buffer.from(JSON.stringify(proof)).equals(proof),
     'ese era el contenido real de la columna')

  // Sin comentarios: la prosa de arriba cita `ots_proof: proof` a proposito, y
  // buscarla a secas seria la trampa de siempre.
  const sinComentarios = (f: string) =>
    readFileSync(join(process.cwd(), f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

  const ots = sinComentarios('src/lib/chain/ots.ts')
  ok('se ancla convirtiendo, no pasando el Buffer', ots.includes('ots_proof: toBytea(proof)'))
  ok('y nunca crudo', !/ots_proof:\s*proof\b/.test(ots))

  for (const f of ['src/app/api/cron/anchor-upgrade/route.ts', 'src/app/api/chain/ots/[hash]/route.ts']) {
    ok(`${f.split('/').slice(-2).join('/')} lee con fromBytea`,
       readFileSync(join(process.cwd(), f), 'utf8').includes('fromBytea('))
  }

  const cron = sinComentarios('src/app/api/cron/anchor-upgrade/route.ts')
  ok('un fallo al revisar tambien cuenta como intento',
     cron.slice(cron.indexOf('} catch (err) {')).includes('upgrade_attempts:'),
     'sin eso un ancla rota se ve igual que una que nadie ha revisado')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)