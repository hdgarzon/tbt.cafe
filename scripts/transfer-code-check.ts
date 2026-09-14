import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * El codigo de traspaso se va entero — Work Order 01, Step 9.
 *
 * Se generaba en complete-tbt y en complete-transfer, se hasheaba en
 * works.transfer_code_hash y se tiraba: no llegaba a nadie y nada comparaba
 * nunca el hash. Esta guarda impide que vuelva a medias —otra vez un secreto al
 * portador que nadie recibe— y sostiene lo que el borrado no puede cambiar: la
 * obra vuelve a quedar transferible despues de un traspaso.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
// Sin comentarios: las cabeceras hablan de lo que se quita para explicarlo.
const sqlOf = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// ---- el codigo
{
  ok('src/lib/transfer-code.ts ya no existe', !existsSync(join(root, 'src/lib/transfer-code.ts')))

  const generators: string[] = []
  const hashWrites: string[] = []
  const walk = (dir: string) => {
    const names = readdirSync(join(root, dir))
    for (let i = 0; i < names.length; i++) {
      const rel = join(dir, names[i])
      if (statSync(join(root, rel)).isDirectory()) {
        walk(rel)
        continue
      }
      if (!/\.(ts|tsx)$/.test(rel)) continue
      const src = read(rel)
      if (src.includes('generateTransferCode(') || src.includes("from '@/lib/transfer-code'")) generators.push(rel)
      if (/transfer_code_hash\s*:/.test(src)) hashWrites.push(rel)
    }
  }
  walk('src')
  ok('nadie genera un codigo', generators.length === 0, generators.join(', '))
  ok('nadie escribe transfer_code_hash', hashWrites.length === 0, hashWrites.join(', '))

  // El bloque que se fue tambien devolvia la obra a 'active'. Sin eso se queda en
  // 'transferred', y el atajo de reintento de la ruta tomaria el siguiente
  // traspaso de la misma obra por uno ya completado.
  const transfer = read('src/app/api/complete-transfer/route.ts')
  const closed = transfer.indexOf("transfer_status: 'transferred'")
  const reopened = transfer.indexOf("update({ transfer_status: 'active' })")
  ok(
    'complete-transfer devuelve la obra a active despues de traspasarla',
    closed > -1 && reopened > closed,
    'sin esto el siguiente traspaso de la obra responde alreadyCompleted'
  )

  // Defensivo, y se queda: si algun dia vuelve una clave, no llega a Arweave.
  ok(
    'los registros siguen prohibiendo la clave',
    read('src/lib/chain/records.ts').includes("'transfer_code', 'transferCode'")
  )
}

// ---- la migracion
{
  const m = sqlOf('supabase/migrations/046_drop_transfer_code.sql')
  ok('suelta la columna', /alter table public\.works drop column if exists transfer_code_hash;/.test(m))
  ok('suelta el indice', /drop index if exists public\.works_transfer_code_hash_idx;/.test(m))
  ok('suelta la vista de transicion de la 045', /drop view if exists public\.certificates;/.test(m))
  ok('sin cascade', !/\bcascade\b/i.test(m), 'lo que dependa de algo de esto tiene que fallar aqui, no en silencio')
  ok(
    'mira las funciones antes de soltar la columna',
    m.indexOf("prosrc ilike '%transfer_code_hash%'") > -1 &&
      m.indexOf("prosrc ilike '%transfer_code_hash%'") < m.indexOf('drop column'),
    'un drop column no avisa de una funcion que la nombra'
  )
  ok('corre en una transaccion', /^\s*begin;/m.test(m) && /^\s*commit;/m.test(m))
}

// ---- el snapshot
{
  const snap = read('supabase/schema-snapshot.sql')
  ok('snapshot: sin transfer_code_hash', !snap.includes('transfer_code_hash'))
  ok('snapshot: sin el comentario de una columna que no existe', !snap.includes('comment on column public.works.transfer_code '))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
