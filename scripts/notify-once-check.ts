import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Una notificacion se escribe una vez — Work Order 01, Step 21.
 *
 * `notify()` insertaba sin mas y nada en la tabla lo impedia dos veces: un MMS
 * fallido avisaba dos veces, y otra mas con cada callback repetido. Cada aviso de
 * pago que se conecte despues vendra de un webhook que se reintenta. Esta guarda
 * sostiene las tres piezas: la tabla rechaza el segundo intento, `notify()` lo
 * lee como "ya avisado" y no manda otro correo, y ninguna llamada se olvida de
 * decir que hecho avisa.
 *
 * Y una cuarta, que la clave vuelve necesaria: la persona solo puede marcar como
 * leida. Si pudiera reescribir sus notificaciones, podria preparar una que
 * choque con un aviso futuro de cambio de destino de cobro y silenciarlo.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
// Sin comentarios: las cabeceras citan lo que se prohibe para explicarlo.
const sqlOf = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// ---- la migracion
{
  const m = sqlOf('supabase/migrations/047_notifications_once.sql')
  ok('añade dedupe_key', /alter table public\.notifications add column if not exists dedupe_key text;/.test(m))
  ok(
    'indice unico por persona, evento y clave',
    /create unique index if not exists notifications_dedupe_idx\s+on public\.notifications \(user_id, event_key, dedupe_key\)\s+where dedupe_key is not null;/.test(m)
  )
  ok('retira insert, update y delete al cliente', /revoke insert, update, delete on public\.notifications from anon, authenticated;/.test(m))
  ok('devuelve UPDATE solo sobre read_at', /grant update \(read_at\) on public\.notifications to authenticated;/.test(m))
  ok(
    'ningun privilegio de escritura sobre la tabla entera',
    !/grant (insert|update|delete|all)(?! \(read_at\))[^;]*on public\.notifications/.test(m),
    'la RLS filtra filas, no columnas: con UPDATE de tabla se puede reescribir el evento'
  )
  ok('se comprueba columna por columna', m.includes("has_column_privilege('authenticated', 'public.notifications', c.column_name, 'UPDATE')"))
  ok('corre en una transaccion', /^\s*begin;/m.test(m) && /^\s*commit;/m.test(m))
}

// ---- notify()
{
  const src = read('src/lib/notify.ts')
  ok('dedupeKey es obligatorio en el tipo', /\n\s*dedupeKey: string\n/.test(src) && !src.includes('dedupeKey?:'))
  ok('se escribe en dedupe_key', /dedupe_key: params\.dedupeKey/.test(src))

  const insertAt = src.indexOf(".from('notifications').insert(")
  const duplicateAt = src.indexOf("error.code === '23505'")
  const emailAt = src.indexOf('sendNotificationEmail(supabase')
  ok('el choque se lee despues del insert', insertAt > -1 && duplicateAt > insertAt)
  ok('y antes del correo', duplicateAt > -1 && emailAt > duplicateAt, 'un reintento mandaria un segundo correo')
  ok('el choque termina ahi', /error\.code === '23505'\) return/.test(src))
}

// ---- cada llamada nombra el hecho que avisa
{
  const calls: string[] = []
  const missing: string[] = []
  const walk = (dir: string) => {
    const names = readdirSync(join(root, dir))
    for (let i = 0; i < names.length; i++) {
      const rel = join(dir, names[i])
      if (statSync(join(root, rel)).isDirectory()) {
        walk(rel)
        continue
      }
      if (!/\.(ts|tsx)$/.test(rel) || rel.endsWith(join('lib', 'notify.ts'))) continue
      const src = read(rel)
      const re = /\bawait notify\(|\bvoid notify\(/g
      let m: RegExpExecArray | null = re.exec(src)
      while (m) {
        const end = src.indexOf('})', m.index)
        const args = src.slice(m.index, end === -1 ? m.index + 500 : end)
        calls.push(rel)
        if (!/\bdedupeKey:/.test(args)) missing.push(`${rel}:${src.slice(0, m.index).split('\n').length}`)
        m = re.exec(src)
      }
    }
  }
  walk('src')
  ok('hay llamadas que revisar', calls.length >= 3, `encontradas: ${calls.length}`)
  ok('todas pasan dedupeKey', missing.length === 0, missing.join(', '))

  ok('el registro avisa una vez por obra', /eventKey: 'registrations',\s*dedupeKey: workId,/.test(read('src/app/api/complete-tbt/route.ts')))

  const replies = read('src/app/api/admin/tickets/route.ts')
  ok(
    'la respuesta del equipo avisa una vez por respuesta',
    /from\('ticket_replies'\)\.insert\(\{[\s\S]{0,300}?\}\)\.select\('id'\)\.single\(\)/.test(replies) && /dedupeKey: reply\.id/.test(replies)
  )

  const tickets = read('src/lib/system-tickets.ts')
  ok(
    'el ticket de sistema avisa una vez por ticket',
    /from\('tickets'\)\.insert\(\{[\s\S]{0,900}?\}\)\.select\('id'\)\.single\(\)/.test(tickets) && /dedupeKey: ticket\.id/.test(tickets),
    'un fallo nuevo tras cerrar el anterior abre otro ticket, y ese si debe avisar'
  )

  const twilio = read('src/app/api/twilio/status/route.ts')
  ok('twilio/status sigue abriendo el ticket', twilio.includes('fileSystemTicket(supabase'))
  ok(
    'pero ya no avisa por su cuenta',
    !/\bnotify\(/.test(twilio) && !twilio.includes("from '@/lib/notify'"),
    'fileSystemTicket ya avisa; el segundo aviso llegaba duplicado'
  )
}

// ---- el cliente solo marca como leida
{
  const writes: string[] = []
  const walk = (dir: string) => {
    const names = readdirSync(join(root, dir))
    for (let i = 0; i < names.length; i++) {
      const rel = join(dir, names[i])
      if (statSync(join(root, rel)).isDirectory()) {
        walk(rel)
        continue
      }
      if (!/\.(ts|tsx)$/.test(rel) || rel.endsWith(join('lib', 'notify.ts'))) continue
      const src = read(rel)
      let at = src.indexOf(".from('notifications')")
      while (at !== -1) {
        const chain = src.slice(at, at + 220)
        const writesSomething = /\.(insert|upsert|delete)\(/.test(chain)
        const update = chain.match(/\.update\((\{[^)]*\})\)/)
        const onlyReadAt = !update || /^\{\s*read_at:[^,}]*\}$/.test(update[1])
        if (writesSomething || !onlyReadAt) writes.push(rel)
        at = src.indexOf(".from('notifications')", at + 1)
      }
    }
  }
  walk('src')
  ok('ningun codigo fuera de notify() escribe mas que read_at', writes.length === 0, writes.join(', '))
}

// ---- el snapshot describe el destino
{
  const snap = read('supabase/schema-snapshot.sql')
  ok('snapshot: la columna', /create table if not exists public\.notifications \([^;]*dedupe_key text/.test(snap))
  ok('snapshot: el indice', snap.includes('create unique index if not exists notifications_dedupe_idx ON public.notifications USING btree (user_id, event_key, dedupe_key) WHERE (dedupe_key IS NOT NULL);'))
  ok('snapshot: el privilegio por columna', snap.includes('grant update (read_at) on public.notifications to authenticated;'))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
