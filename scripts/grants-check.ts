import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Ninguna funcion `security definer` se ejecuta sin pasar por el servidor.
 *
 * Postgres concede EXECUTE a PUBLIC al crear una funcion, y Supabase se lo
 * concede ademas por nombre a `anon` y `authenticated`. Con `security definer`
 * la funcion corre con los permisos de su propietario y se salta la RLS, asi
 * que cada una es un endpoint de PostgREST que acepta la clave anonima: la que
 * viaja en el navegador.
 *
 * Paso tres veces con la misma forma (042, 043, 044): una funcion que recibia a
 * la persona por parametro y a la que nadie le quito el EXECUTE. Esta guarda no
 * busca nombres sueltos. Reconstruye, migracion a migracion y en orden, quien
 * puede ejecutar cada firma —create, drop, revoke, grant— y afirma sobre lo que
 * queda al final.
 *
 * Dos reglas:
 *   1. `anon` no ejecuta ninguna funcion security definer. Las de trigger quedan
 *      fuera: no se pueden invocar como RPC.
 *   2. Si recibe la identidad por parametro (`who`, `approver`, `user_id`...),
 *      tampoco `authenticated`: quien llama escribiria a quien suplanta. Esas
 *      las llama el servidor, con el service role.
 *
 * `create or replace` NO reinicia los permisos de una funcion que ya existia —
 * Postgres los conserva—, y la guarda lo modela igual. Solo `drop` los borra.
 *
 * Solo ve `supabase/migrations`. El esquema base no esta en el repo, asi que una
 * funcion creada fuera de aqui no la cubre.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

type Fn = { name: string; types: string[]; names: string[]; definer: boolean; trigger: boolean; file: string; roles: string[] }

const DEFAULT_ROLES = ['public', 'anon', 'authenticated', 'service_role']
const IDENTITY_PARAM = /^(who|approver|user_id|p_user_id|caller|actor)$/
const ALIASES: Record<string, string> = { int: 'integer', int4: 'integer', int8: 'bigint', bool: 'boolean' }

const normType = (t: string) => {
  const s = t.trim().toLowerCase().replace(/\s+/g, ' ')
  return ALIASES[s] || s
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** Una lista de definicion: `approver uuid default auth.uid()`. */
function parseArgs(list: string): { names: string[]; types: string[] } {
  const names: string[] = []
  const types: string[] = []
  const parts = splitTopLevel(list)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].replace(/\s+default\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, '').trim()
    if (!p) continue
    const words = p.split(/\s+/)
    if (/^(in|out|inout|variadic)$/i.test(words[0])) words.shift()
    names.push(words.length >= 2 ? words[0].toLowerCase() : '')
    types.push(normType(words.length >= 2 ? words.slice(1).join(' ') : words[0]))
  }
  return { names, types }
}

/** Una lista de tipos, la de `drop`, `revoke` o `grant`: `uuid, text`. */
const parseTypes = (list: string) => splitTopLevel(list).map(normType).filter((t) => t !== '')

const key = (name: string, types: string[]) => `${name}(${types.join(', ')})`

function replay(dir: string): Record<string, Fn> {
  const fns: Record<string, Fn> = {}
  const files = readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]
    // Sin comentarios: las cabeceras citan firmas viejas para explicar fallos.
    const sql = readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')

    const stmt =
      /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(|drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)\s*\(([^)]*)\)|(revoke|grant)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s+(?:from|to)\s+([^;]+);/gi
    let m: RegExpExecArray | null
    while ((m = stmt.exec(sql)) !== null) {
      if (m[1]) {
        // Los argumentos pueden llevar parentesis (`auth.uid()`): se equilibran.
        let i = stmt.lastIndex
        let depth = 1
        let args = ''
        while (i < sql.length) {
          const c = sql[i]
          if (c === '(') depth++
          if (c === ')') {
            depth--
            if (depth === 0) break
          }
          args += c
          i++
        }
        const rest = sql.slice(i + 1)
        const tag = /\bas\s+\$(\w*)\$/i.exec(rest)
        if (!tag) continue
        const header = rest.slice(0, tag.index)
        const close = rest.indexOf(`$${tag[1]}$`, tag.index + tag[0].length)
        // El cuerpo se salta: lo que diga dentro no es un permiso.
        stmt.lastIndex = i + 1 + (close >= 0 ? close + tag[1].length + 2 : tag.index + tag[0].length)

        const parsed = parseArgs(args)
        const k = key(m[1].toLowerCase(), parsed.types)
        const existing = fns[k]
        fns[k] = {
          name: m[1].toLowerCase(),
          types: parsed.types,
          names: parsed.names,
          definer: /security\s+definer/i.test(header),
          trigger: /returns\s+trigger\b/i.test(header),
          file,
          roles: existing ? existing.roles : DEFAULT_ROLES.slice(),
        }
      } else if (m[2]) {
        delete fns[key(m[2].toLowerCase(), parseTypes(m[3]))]
      } else if (m[4]) {
        const f = fns[key(m[5].toLowerCase(), parseTypes(m[6]))]
        if (!f) continue
        const who = m[7].split(',').map((r) => r.trim().toLowerCase())
        if (m[4].toLowerCase() === 'revoke') {
          f.roles = f.roles.filter((r) => who.indexOf(r) === -1)
        } else {
          for (let j = 0; j < who.length; j++) if (f.roles.indexOf(who[j]) === -1) f.roles.push(who[j])
        }
      }
    }
  }
  return fns
}

const dir = process.argv[2] || join(__dirname, '..', 'supabase', 'migrations')
const fns = replay(dir)
const keys = Object.keys(fns).sort()
const definers = keys.filter((k) => fns[k].definer && !fns[k].trigger)

// ---- que la guarda vea lo que tiene que ver
ok('encuentra las funciones security definer', definers.length >= 10, `solo ${definers.length}: el parser no esta leyendo las migraciones`)
ok('un drop retira la firma vieja', !fns['admin_has(text, uuid)'] && !fns['admin_resolve_approval(uuid, text, uuid)'],
   'si 013 sigue viva aqui, drop no se esta aplicando y todo lo demas es ficcion')
ok('create or replace conserva los permisos', !!fns['admin_resolve_approval(uuid, text)'] &&
   fns['admin_resolve_approval(uuid, text)'].roles.indexOf('anon') === -1,
   '043 redefine admin_resolve_approval; si eso le devolviera el EXECUTE a anon, la guarda mentiria')

// ---- regla 1: nada security definer al alcance de la clave anonima
for (let i = 0; i < definers.length; i++) {
  const f = fns[definers[i]]
  const open = f.roles.indexOf('anon') !== -1 || f.roles.indexOf('public') !== -1
  ok(`sin sesion no se ejecuta ${definers[i]}`, !open, `${f.file}: falta revoke ... from public, anon`)
}

// ---- regla 2: identidad por parametro, solo desde el servidor
for (let i = 0; i < definers.length; i++) {
  const f = fns[definers[i]]
  const identity = f.names.filter((n) => IDENTITY_PARAM.test(n))
  if (identity.length === 0) continue
  const open = f.roles.indexOf('authenticated') !== -1 || f.roles.indexOf('public') !== -1
  ok(`${definers[i]} recibe '${identity.join(', ')}' y solo la llama el servidor`, !open,
     `${f.file}: authenticated podria nombrar a otra persona`)
}

// ---- las cinco de 044 siguen al alcance de quien las necesita
const SERVER_ONLY = [
  'private_code_register_failure(uuid)',
  'private_code_clear_failures(uuid)',
  'consume_biometric_proof(uuid, text)',
  'notification_enabled(uuid, text)',
  'provider_failure_summary(integer)',
]
for (let i = 0; i < SERVER_ONLY.length; i++) {
  const f = fns[SERVER_ONLY[i]]
  ok(`el servidor sigue pudiendo llamar ${SERVER_ONLY[i]}`, !!f && f.roles.indexOf('service_role') !== -1,
     'revocar sin conservar service_role romperia el step-up o las notificaciones')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
