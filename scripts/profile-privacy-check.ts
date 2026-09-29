import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Un perfil público no lleva los datos privados — migración 053.
 *
 * La política de lectura de `profiles` es `using (true)` y la RLS filtra filas,
 * no columnas: con SELECT sobre la tabla entera, la clave anónima leía el
 * teléfono, el e-Mail, la dirección, el documento fiscal, el nombre legal y el
 * hash del código privado de todas las personas.
 *
 * Esta guarda sostiene:
 *  - la 053 retira la lectura de la tabla y la devuelve solo columna por columna;
 *  - ninguna columna privada está en esa lista;
 *  - la función de lo propio responde por auth.uid(), no expone el hash y no la
 *    puede ejecutar anon;
 *  - ningún código del cliente pide una columna privada a la tabla.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const sql = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const PRIVATE = [
  'email', 'phone', 'physical_address', 'tax_id', 'legal_name',
  'recovery_email', 'recovery_email_verified', 'private_code_hash', 'private_code_freq',
]

const M = sql('supabase/migrations/053_profiles_private_columns.sql')

// ---- la tabla
{
  ok('se retira la lectura de la tabla entera', /revoke select on public\.profiles from anon, authenticated;/.test(M))
  const grant = (M.match(/grant select \(([\s\S]*?)\)\s*on public\.profiles to anon, authenticated;/) ?? [])[1] ?? ''
  const cols = grant.split(',').map((c) => c.trim()).filter(Boolean)
  ok('y se devuelve columna por columna', cols.length > 0)
  const leaked = cols.filter((c) => PRIVATE.indexOf(c) !== -1)
  ok('ninguna columna privada en la lista pública', leaked.length === 0, leaked.join(', '))
}

// ---- lo propio
{
  ok('la función existe', /create or replace function public\.my_profile_private\(\)/.test(M))
  ok('responde por quien llama', /where p\.id = auth\.uid\(\)/.test(M))
  ok('no devuelve el hash del código privado', !/'private_code_hash'/.test(M) && /'has_private_code', p\.private_code_hash is not null/.test(M))
  ok('anon no la ejecuta', /revoke execute on function public\.my_profile_private\(\) from public, anon, authenticated;/.test(M) &&
     /grant execute on function public\.my_profile_private\(\) to authenticated;/.test(M))
}

// ---- el cliente no pide columnas privadas a la tabla
//
// Todo lo que no es ruta de API corre, o puede correr, en el navegador. Las
// rutas de API leen con el service role cuando necesitan lo privado.
{
  const hits: string[] = []
  const walk = (dir: string) => {
    const names = readdirSync(join(root, dir))
    for (let i = 0; i < names.length; i++) {
      const rel = join(dir, names[i])
      if (statSync(join(root, rel)).isDirectory()) {
        if (rel.startsWith(join('src', 'app', 'api'))) continue
        walk(rel)
        continue
      }
      if (!/\.(ts|tsx)$/.test(rel)) continue
      const src = read(rel)
      if (src.includes('createAdminClient')) continue
      const re = /from\('profiles'\)\s*\.select\(\s*'([^']*)'/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const cols = m[1].split(',').map((c) => c.trim())
        const bad = cols.filter((c) => PRIVATE.indexOf(c) !== -1 || c === '*')
        if (bad.length) hits.push(`${rel}: ${bad.join(', ')}`)
      }
    }
  }
  walk('src')
  ok('ningún código del cliente lee columnas privadas de profiles', hits.length === 0, hits.join(' · '))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
