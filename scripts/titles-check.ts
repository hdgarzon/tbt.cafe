import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * El certificado pasa a ser un titulo — Work Order 01, Steps 7 y 8.
 *
 * No es un renombre de estetica: el certificado era una credencial al portador,
 * y el titulo acredita la propiedad sin llevar nada secreto. Esta guarda sostiene
 * las tres partes del cambio: la migracion renombra y deja una vista de
 * transicion con la RLS de quien llama, las columnas que el titulo necesita
 * existen con sus valores permitidos, y ningun codigo vuelve a escribir en la
 * tabla vieja.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
// Sin comentarios: las cabeceras hablan del nombre viejo para explicarlo.
const sqlOf = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// ---- la migracion
{
  const m = sqlOf('supabase/migrations/045_certificates_become_titles.sql')
  ok('renombra la tabla', /alter table public\.certificates rename to titles/.test(m))
  ok(
    'deja el nombre viejo como vista con la RLS de quien llama',
    /create view public\.certificates with \(security_invoker = on\)/.test(m),
    'sin security_invoker la vista corre como su dueño y se salta la RLS'
  )
  ok(
    'la vista se crea antes de las columnas nuevas',
    m.indexOf('create view public.certificates') > -1 &&
      m.indexOf('create view public.certificates') < m.indexOf('add column if not exists kind'),
    'si las incluye, un insert por la vista no toma los valores por defecto'
  )
  ok('recrea exactamente dos politicas', (m.match(/create policy "/g) ?? []).length === 2)

  const COLS = [
    ['titles', 'supersedes'], ['titles', 'kind'], ['titles', 'delivery_state'],
    ['works', 'owner_index'], ['works', 'creator_status'], ['works', 'provenance_hash'],
  ]
  for (let i = 0; i < COLS.length; i++) {
    const [t, c] = COLS[i]
    ok(`añade ${t}.${c}`, new RegExp(`alter table public\\.${t}[^;]*add column if not exists ${c} `).test(m))
  }
  ok('kind: standard o bonded', m.includes("check (kind in ('standard', 'bonded'))"))
  ok('delivery_state: pending, sent o failed', m.includes("check (delivery_state in ('pending', 'sent', 'failed'))"))
  ok('creator_status: living, deceased o unknown', m.includes("check (creator_status in ('living', 'deceased', 'unknown'))"))
  ok('provenance_hash con el formato de content_hash', m.includes("provenance_hash ~ '^sha256:[0-9a-f]{64}$'"))
  ok(
    'owner_index no se recalcula una vez avanzado',
    /and w\.owner_index = 1/.test(m),
    'forma parte del numero del titulo: reasignarlo rompe los ya emitidos'
  )
}

// ---- ningun codigo escribe ya en la tabla vieja
{
  const hits: string[] = []
  const walk = (dir: string) => {
    const names = readdirSync(join(root, dir))
    for (let i = 0; i < names.length; i++) {
      const rel = join(dir, names[i])
      if (statSync(join(root, rel)).isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(rel) && read(rel).includes("from('certificates')")) hits.push(rel)
    }
  }
  walk('src')
  ok('src no nombra la tabla vieja', hits.length === 0, hits.join(', '))
  ok('complete-tbt emite en titles', /\.from\('titles'\)\s*\.insert\(/.test(read('src/app/api/complete-tbt/route.ts')))
  ok('complete-transfer emite en titles', /\.from\('titles'\)\s*\.insert\(/.test(read('src/app/api/complete-transfer/route.ts')))
  ok('administracion lee titles', /\.from\('titles'\)/.test(read('src/app/api/admin/works/route.ts')))
}

// ---- el snapshot describe el destino
{
  const snap = read('supabase/schema-snapshot.sql')
  ok('snapshot: la tabla titles', snap.includes('create table if not exists public.titles ('))
  ok('snapshot: sin la tabla vieja', !snap.includes('create table if not exists public.certificates ('))
  ok('snapshot: la vista de transicion', /create or replace view public\.certificates with \(security_invoker = on\)/.test(snap))
  ok('snapshot: owner_index', snap.includes('owner_index integer default 1 not null'))
  ok('snapshot: kind y delivery_state', snap.includes("kind text default 'standard'::text not null") && snap.includes("delivery_state text default 'pending'::text not null"))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
