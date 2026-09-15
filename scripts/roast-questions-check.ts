import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Nadie publica preguntas en Roast, por ahora — Update Package 01, N11.
 *
 * Una pregunta era pública en cuanto se escribía: la 022 dejaba insertar a quien
 * tuviera sesión y leer a cualquiera, y no existe herramienta para revisarlas
 * antes. De las dos salidas que da el paquete se eligió apagar el envío hasta
 * que la moderación exista.
 *
 * Esta guarda sostiene:
 *  - tras reproducir todas las migraciones, roast_questions no tiene ninguna
 *    política que deje insertar al cliente, y la de lectura sigue;
 *  - la 048 lo comprueba ella misma al aplicarse;
 *  - el snapshot del esquema dice lo mismo;
 *  - el componente ya no ofrece preguntar, y nada en src escribe en la tabla.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const sql = (s: string) => s.replace(/--.*$/gm, '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

function walk(dir: string, out: string[]): string[] {
  const entries = readdirSync(join(root, dir), { withFileTypes: true })
  for (let i = 0; i < entries.length; i++) {
    const rel = `${dir}/${entries[i].name}`
    if (entries[i].isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(entries[i].name)) out.push(rel)
  }
  return out
}

// ---- las migraciones, en orden
{
  const MIGRATION = 'supabase/migrations/048_roast_questions_posting_off.sql'
  ok('existe la 048', existsSync(join(root, MIGRATION)))

  const files = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
  const policies: Record<string, string> = {}
  const CREATE = /create policy "([^"]+)" on public\.roast_questions\s+for (\w+)/gi
  const DROP = /drop policy if exists "([^"]+)" on public\.roast_questions/gi
  for (let i = 0; i < files.length; i++) {
    const text = sql(read(`supabase/migrations/${files[i]}`))
    // Cada sentencia en su orden: un drop seguido de su create deja la política viva.
    const events: { at: number; kind: 'create' | 'drop'; name: string; cmd?: string }[] = []
    let m: RegExpExecArray | null
    CREATE.lastIndex = 0
    while ((m = CREATE.exec(text))) events.push({ at: m.index, kind: 'create', name: m[1], cmd: m[2].toLowerCase() })
    DROP.lastIndex = 0
    while ((m = DROP.exec(text))) events.push({ at: m.index, kind: 'drop', name: m[1] })
    events.sort((a, b) => a.at - b.at)
    for (let j = 0; j < events.length; j++) {
      const e = events[j]
      if (e.kind === 'create') policies[e.name] = e.cmd as string
      else delete policies[e.name]
    }
  }
  const names = Object.keys(policies)
  const writers = names.filter((n) => policies[n] === 'insert' || policies[n] === 'all')
  ok('ninguna política deja insertar al cliente', writers.length === 0, writers.join(', '))
  ok('la de lectura sigue', policies['roast questions readable'] === 'select')

  const m048 = existsSync(join(root, MIGRATION)) ? sql(read(MIGRATION)) : ''
  ok('la 048 retira la política de inserción', m048.includes('drop policy if exists "own roast questions insertable" on public.roast_questions;'))
  ok('y se comprueba al aplicarse', /from pg_policies[\s\S]{0,200}tablename = 'roast_questions'[\s\S]{0,120}cmd in \('INSERT', 'ALL'\)[\s\S]{0,120}raise exception/.test(m048))
}

// ---- el snapshot
{
  const snap = read('supabase/schema-snapshot.sql')
  ok('el snapshot no tiene política de inserción en roast_questions', !/create policy "[^"]+" on public\.roast_questions for (insert|all)/i.test(snap))
  ok('y conserva la de lectura', snap.includes('create policy "roast questions readable" on public.roast_questions for select'))
}

// ---- la interfaz y el resto del código
{
  const comp = code(read('src/components/RoastQuestions.tsx'))
  ok('el componente sigue leyendo las preguntas', /from\('roast_questions'\)\s*\.select\(/.test(comp))
  ok('ya no inserta', !comp.includes('.insert('))
  ok('ya no muestra el campo para preguntar', !comp.includes('<textarea') && !comp.includes('t.roast.askPlaceholder') && !comp.includes('{t.roast.ask}'))

  const files = walk('src', [])
  const writers: string[] = []
  for (let i = 0; i < files.length; i++) {
    const text = code(read(files[i]))
    if (/from\('roast_questions'\)\s*\.(insert|upsert|update)\(/.test(text)) writers.push(files[i])
  }
  ok('nada en src escribe en roast_questions', writers.length === 0, writers.join(', '))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
