import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Nobody rewrites a transfer from the browser — the notifications lesson (047),
 * applied to the table that carries the money.
 *
 * The base schema gave `transfers` an UPDATE policy for either participant, and
 * RLS filters rows, not columns: a buyer or seller holding the anon key and a
 * session could PATCH sale_price, payment_status, the stored amounts,
 * charge_path, holder_named or outcome on their own rows. The two INSERT
 * policies were worse: "Users can create transfers" let a buyer insert a row
 * naming someone else's work and its owner, already `completed`, and
 * /api/complete-transfer would then move the work with the service role.
 *
 * No browser code writes `transfers`; every write is a server route. So this
 * guard holds four things:
 *
 *  - replaying the base policies and every migration, no INSERT, UPDATE,
 *    DELETE or ALL policy on `transfers` is left;
 *  - the client roles end with no table-level write privilege, and with column
 *    UPDATE only on the columns listed in BROWSER_WRITES (none today);
 *  - no code writes `transfers` through a session-bound client: not from a
 *    'use client' file, not through '@/lib/supabase', not through the
 *    `supabase` that authenticate() hands a route;
 *  - the snapshot describes the same destination.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
// Without comments: headers quote what they forbid in order to explain it.
const sqlOf = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

/** Columns the browser may still UPDATE on its own rows. Empty: it writes none. */
const BROWSER_WRITES: string[] = []
const CLIENT_ROLES = ['anon', 'authenticated', 'public']

// The base schema is in no migration; these are its write policies on transfers.
const BASE_WRITE_POLICIES = [
  'Participantes pueden actualizar transferencias',
  'Propietarios pueden iniciar transferencias',
  'Users can create transfers',
]

/**
 * The method names chained after a position: `.update({...}).eq('id', x)` gives
 * ['update', 'eq']. Stops at the first thing that is not `.name(...)`, so a
 * select followed by an update on the next statement is not read as one.
 */
const chainAfter = (src: string, from: number): string[] => {
  const names: string[] = []
  let i = from
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] !== '.') return names
    const name = src.slice(i + 1).match(/^([A-Za-z_$][\w$]*)\s*\(/)
    if (!name) return names
    names.push(name[1])
    i += 1 + name[0].length
    let depth = 1
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        i++
        while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1
      } else if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
  }
};

type Main = () => Promise<void>

const main: Main = async () => {
  const dir = 'supabase/migrations'
  const files = readdirSync(join(root, dir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()

  // ---- policies: replay create and drop over the base
  {
    const live: Record<string, string> = {}
    for (let i = 0; i < BASE_WRITE_POLICIES.length; i++) live[BASE_WRITE_POLICIES[i]] = 'base schema'

    const re = /\b(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?transfers\b([^;]*);/gi
    for (let i = 0; i < files.length; i++) {
      const sql = sqlOf(read(join(dir, files[i])))
      let m: RegExpExecArray | null = re.exec(sql)
      while (m) {
        const verb = m[1].toLowerCase()
        const name = m[2]
        const rest = m[3].toLowerCase()
        if (verb === 'drop') delete live[name]
        else if (/\bfor\s+(insert|update|delete|all)\b/.test(rest) || !/\bfor\s+select\b/.test(rest)) live[name] = files[i]
        m = re.exec(sql)
      }
      re.lastIndex = 0
    }

    const left = Object.keys(live)
    ok(
      'no write policy on transfers survives the migrations',
      left.length === 0,
      left.map((n) => `"${n}" (${live[n]})`).join(', ')
    )
  }

  // ---- privileges: replay grant and revoke for the client roles
  {
    // Supabase grants every table privilege to anon and authenticated by default.
    const table: Record<string, boolean> = {}
    const cols: Record<string, string[]> = {}
    for (let r = 0; r < CLIENT_ROLES.length; r++) {
      table[`${CLIENT_ROLES[r]}:insert`] = CLIENT_ROLES[r] !== 'public'
      table[`${CLIENT_ROLES[r]}:update`] = CLIENT_ROLES[r] !== 'public'
      table[`${CLIENT_ROLES[r]}:delete`] = CLIENT_ROLES[r] !== 'public'
      cols[CLIENT_ROLES[r]] = []
    }

    const re = /\b(grant|revoke)\s+([a-z_,\s()]+?)\s+on\s+(?:table\s+)?(?:public\.)?transfers\s+(?:to|from)\s+([a-z_,\s]+?);/gi
    for (let i = 0; i < files.length; i++) {
      const sql = sqlOf(read(join(dir, files[i])))
      let m: RegExpExecArray | null = re.exec(sql)
      while (m) {
        const verb = m[1].toLowerCase()
        const privs = m[2].toLowerCase()
        const roles = m[3].toLowerCase().split(',').map((s) => s.trim())
        // "update (a, b)" is a column grant; "insert, update, delete" is a table one.
        const colGrant = privs.match(/^update\s*\(([^)]*)\)$/)
        for (let r = 0; r < roles.length; r++) {
          const role = roles[r]
          if (CLIENT_ROLES.indexOf(role) === -1) continue
          if (colGrant) {
            const names = colGrant[1].split(',').map((s) => s.trim())
            cols[role] = verb === 'grant' ? cols[role].concat(names) : cols[role].filter((c) => names.indexOf(c) === -1)
            continue
          }
          const list = privs === 'all' || privs === 'all privileges' ? ['insert', 'update', 'delete'] : privs.split(',').map((s) => s.trim())
          for (let p = 0; p < list.length; p++) {
            if (['insert', 'update', 'delete'].indexOf(list[p]) === -1) continue
            table[`${role}:${list[p]}`] = verb === 'grant'
            if (verb === 'revoke' && list[p] === 'update') cols[role] = []
          }
        }
        m = re.exec(sql)
      }
      re.lastIndex = 0
    }

    const held = Object.keys(table).filter((k) => table[k])
    ok('no client role keeps INSERT, UPDATE or DELETE on the whole table', held.length === 0, held.join(', '))

    const extra: string[] = []
    for (let r = 0; r < CLIENT_ROLES.length; r++) {
      const c = cols[CLIENT_ROLES[r]]
      for (let i = 0; i < c.length; i++) if (BROWSER_WRITES.indexOf(c[i]) === -1) extra.push(`${CLIENT_ROLES[r]}.${c[i]}`)
    }
    ok('column UPDATE only on what the browser writes', extra.length === 0, extra.join(', '))
  }

  // ---- the migration that closes it checks itself
  {
    let closer = ''
    for (let i = 0; i < files.length; i++) {
      const sql = sqlOf(read(join(dir, files[i])))
      if (/drop policy if exists "Participantes pueden actualizar transferencias" on public\.transfers;/.test(sql)) closer = files[i]
    }
    ok('a migration drops the participants\' update policy', closer !== '')
    if (closer) {
      const sql = sqlOf(read(join(dir, closer)))
      ok('it revokes insert, update and delete from the client roles', /revoke insert, update, delete on public\.transfers from anon, authenticated;/.test(sql))
      ok('it checks every column', sql.includes("has_column_privilege('authenticated', 'public.transfers', c.column_name, 'UPDATE')"))
      ok('it checks pg_policies', /from pg_policies[\s\S]{0,200}tablename = 'transfers'/.test(sql))
      ok('it raises when the check fails', /\braise exception\b/.test(sql))
      ok('it runs in a transaction', /^\s*begin;/m.test(sql) && /^\s*commit;/m.test(sql))
    }
  }

  // ---- no session-bound client writes transfers
  {
    const writes: string[] = []
    const seen: string[] = []
    const walk = (d: string) => {
      const names = readdirSync(join(root, d))
      for (let i = 0; i < names.length; i++) {
        const rel = join(d, names[i])
        if (statSync(join(root, rel)).isDirectory()) {
          walk(rel)
          continue
        }
        if (!/\.(ts|tsx)$/.test(rel)) continue
        const src = read(rel)
        const isClient = /^\s*['"]use client['"]/.test(src)
        const browserClient = /from '@\/lib\/supabase'/.test(src)
        const re = /([A-Za-z_$][\w$]*(?:\(\))?)\s*\.from\(\s*'transfers'\s*\)/g
        let m: RegExpExecArray | null = re.exec(src)
        while (m) {
          const methods = chainAfter(src, m.index + m[0].length)
          if (methods.some((name) => ['insert', 'update', 'upsert', 'delete'].indexOf(name) !== -1)) {
            const where = `${rel}:${src.slice(0, m.index).split('\n').length}`
            seen.push(where)
            if (isClient || browserClient || m[1] === 'supabase') writes.push(`${where} (${m[1]})`)
          }
          m = re.exec(src)
        }
      }
    }
    walk('src')
    ok('there are server writes to look at', seen.length >= 10, `found: ${seen.length}`)
    ok('none goes through a session-bound client', writes.length === 0, writes.join(', '))
  }

  // ---- the snapshot describes the destination
  {
    const snap = read('supabase/schema-snapshot.sql')
    ok(
      'snapshot: no write policy on transfers',
      !/create policy "[^"]+" on public\.transfers for (insert|update|delete|all)\b/.test(snap)
    )
    ok('snapshot: the select policy stays', snap.includes('create policy "Participantes pueden ver transferencias" on public.transfers for select'))
    ok('snapshot: the revoke', snap.includes('revoke insert, update, delete on public.transfers from anon, authenticated;'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall in order' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
