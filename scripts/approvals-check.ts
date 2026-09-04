import { readFileSync } from 'fs'
import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { APPROVAL_TTL_MS } from '../src/lib/admin/guard'

/**
 * La regla de dos personas tiene TRES tiempos — Backend Spec 07 §1.3.
 *
 * Alguien la pide, otra persona la aprueba, y quien la pidio la aplica. El
 * tercero no existia: ningun cliente volvia a llamar a la ruta de la accion con
 * el `approvalId`, asi que aprobar marcaba la fila y no cambiaba nada. Y como
 * la lista solo miraba `status = 'pending'`, la solicitud desaparecia de la
 * pantalla en el momento en que dejaba de poder hacerse sola.
 *
 * Casi todo lo de aqui se afirma sobre CONSTRUCCIONES del codigo, nunca sobre
 * la prosa: un comentario que explique el fallo haria pasar una prueba que
 * buscara su nombre.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const guard = read('src/lib/admin/guard.ts')
const route = read('src/app/api/admin/approvals/route.ts')
const page = read('src/app/admin/page.tsx')
const migration = read('supabase/migrations/037_approval_execution.sql')

// ---- la autorización se gasta al usarse
{
  const claim = guard.slice(guard.indexOf('if (params.approvalId)'), guard.indexOf('return {\n      proceed: false'))

  ok('se sella con un UPDATE, no se lee y se confía', claim.includes(".update({ executed_at:"))
  ok('solo si nadie la ha usado', claim.includes(".is('executed_at', null)"))
  ok('solo si está aprobada', claim.includes(".eq('status', 'approved')"))
  ok('solo para ESTA acción', claim.includes(".eq('action', params.action)"))
  ok('solo para quien la inició', claim.includes(".eq('initiator_id', params.actor.userId)"))
  ok('y nunca si aprobó quien la inició', claim.includes(".neq('approver_id', params.actor.userId)"))
  ok('y no si es de hace más de un día', claim.includes(".gte('resolved_at'"))

  ok('todas las condiciones van DENTRO del escritorio',
     claim.indexOf(".update({ executed_at:") < claim.indexOf(".is('executed_at', null)"),
     'una comprobación fuera deja pasar dos llamadas simultáneas')

  ok('ya no autoriza desde una lectura suelta',
     !guard.includes("data.status === 'approved' &&"),
     'ese era el camino que no consumía nada')
}

// ---- lo aprobado y sin hacer se ve
{
  ok('la lista devuelve lo que espera a quien lo inició', route.includes('awaiting:'))
  ok('y solo lo suyo', route.includes(".eq('initiator_id', auth.user.id)"))
  ok('y solo lo que no se ha ejecutado', route.includes(".is('executed_at', null)"))
  ok('se barre lo caducado ANTES de listar',
     route.indexOf('sweepExpiredApprovals(') > 0 &&
     route.indexOf('sweepExpiredApprovals(') < route.indexOf(".eq('status', 'pending')"),
     'una solicitud que nadie puede aprobar no la resuelve nadie, y se quedaba pendiente para siempre')
  ok('el barrido solo toca lo vencido',
     guard.includes(".eq('status', 'pending')") && guard.includes(".lt('expires_at'"))
}

// ---- y se puede aplicar
{
  ok('el panel sabe aplicar', page.includes('async function apply(a: Approval)'))
  ok('y manda el approvalId', page.includes('approvalId: a.id'))
  ok('aprobar dice que todavía falta un paso',
     page.includes("'Approved. The person who started it has to apply it now.'"))
  ok('una acción sin forma de aplicarse no enseña un botón muerto',
     page.includes('APPLY[a.action] ?'))
}

// ---- LA GUARDA DE VERDAD: ninguna acción de alto riesgo se queda sin aplicar
//
// Es la que impide que el fallo vuelva. Una acción nueva tras `gateHighRisk`
// sin entrada en el mapa se aprobaría y no haría nada, igual que antes.
{
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${name}`
      if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel)
      else if (rel.endsWith('.ts') || rel.endsWith('.tsx')) files.push(rel)
    }
  }
  walk('src/app/api')

  const actions = new Set<string>()
  for (const f of files) {
    const src = read(f)
    let at = src.indexOf('gateHighRisk(')
    while (at >= 0) {
      const chunk = src.slice(at, at + 600)
      const m = chunk.match(/action:\s*'([^']+)'/)
      if (m) actions.add(m[1])
      at = src.indexOf('gateHighRisk(', at + 1)
    }
  }

  ok('se encontró al menos una acción de alto riesgo', actions.size > 0, 'si no, la prueba no prueba nada')
  for (const a of Array.from(actions)) {
    ok(`'${a}' se puede aplicar desde el panel`, page.includes(`'${a}': (a) =>`),
       'aprobada y sin entrada en APPLY, no haría nada')
  }
}

// ---- la pared que no se veía
{
  ok('la ruta cuenta a quién MÁS puede aprobar', route.includes('otherApprovers'))
  ok('y el panel lo dice cuando no hay nadie',
     page.includes("'You started this one and nobody else can approve it."),
     'una solicitud que nadie puede aprobar decía «esperando» hasta caducar')
}

// ---- la ventana
{
  ok('lo aprobado vale un día', APPROVAL_TTL_MS === 24 * 60 * 60 * 1000,
     'la misma ventana que la solicitud sin resolver')
  ok('la columna existe en la migración', migration.includes('add column if not exists executed_at timestamptz'))
  ok('y hay índice para la lista de «te toca»', migration.includes("where status = 'approved' and executed_at is null"))
}

// ---- LA GUARDA: quien aprueba es quien llama, no quien se nombre
{
  const core = readFileSync(join(__dirname, '..', 'supabase/migrations/013_admin_core.sql'), 'utf8')
  const fix = readFileSync(
    join(__dirname, '..', 'supabase/migrations/042_approval_identity_from_session.sql'), 'utf8')

  // La cabecera CITA la firma vieja para explicar el fallo. Sobre prosa no se
  // afirma nada: lo que se mira es el SQL, sin comentarios.
  const sql = fix.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

  // La version de tres argumentos aceptaba a quien aprueba por parametro, y con
  // ella una sola persona cumplia la regla de dos nombrando a un colega.
  ok(
    'la firma de tres argumentos queda retirada',
    sql.includes('drop function if exists public.admin_resolve_approval(uuid, text, uuid)'),
    'create or replace no puede quitar un parametro; sin el drop conviven las dos'
  )
  ok(
    'la nueva no recibe a quien aprueba',
    !/create or replace function public\.admin_resolve_approval\([^)]*approver[^)]*\)/.test(sql),
    'un argumento de identidad en una funcion security definer se puede mandar'
  )
  ok(
    'la identidad sale de la sesion, dentro',
    /approver uuid := auth\.uid\(\)/.test(sql),
    'auth.uid() lo firma el token; un parametro lo escribe quien llama'
  )
  ok('sin sesion no se aprueba', /if approver is null then\s*\n\s*raise exception/.test(sql))

  // Postgres concede EXECUTE a PUBLIC al crear la funcion, y este esquema no
  // tenia un solo revoke: se podia invocar con la clave anonima.
  ok(
    'se revoca EXECUTE de public y de anon',
    /revoke execute on function public\.admin_resolve_approval\(uuid, text\) from public/.test(sql) &&
    /revoke execute on function public\.admin_resolve_approval\(uuid, text\) from anon/.test(sql),
    'security definer + EXECUTE a PUBLIC es la puerta abierta'
  )
  ok(
    'y solo la invoca authenticated',
    /grant execute on function public\.admin_resolve_approval\(uuid, text\) to authenticated/.test(sql)
  )

  // Caducada devolvia la fila en vez de lanzar: la ruta no veia error y
  // contestaba 200 anotando una aprobacion que no ocurrio.
  ok(
    'caducada lanza en lugar de contestar que si',
    /if row\.expires_at < now\(\) then\s*\n\s*raise exception/.test(sql),
    'devolver la fila hacia que la bitacora registrase approval.approved'
  )

  // Y que la version vieja sigue siendo la que se describe, para que esta
  // prueba no pase sola el dia que alguien reescriba 013.
  ok(
    'la migracion original es la que se corrige',
    core.includes('approver uuid default auth.uid()'),
    'si 013 ya no tiene el parametro, esta guarda sobra y hay que revisarla'
  )
}

console.log(bad === 0 ? '\ntodo en orden' : `${'\n'}${bad} fallo(s)`)

process.exit(bad === 0 ? 0 : 1)
