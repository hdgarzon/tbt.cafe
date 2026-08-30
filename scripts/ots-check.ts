import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

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
     /result\.upgraded \? \{ ots_proof: result\.proof \}/.test(cron))

  const vercel = JSON.parse(read('vercel.json'))
  const job = (vercel.crons ?? [])[0]
  ok('el cron está declarado', job?.path === '/api/cron/anchor-upgrade')
  ok('cada hora', job?.schedule === '0 * * * *')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
