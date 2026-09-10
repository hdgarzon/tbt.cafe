-- ============================================================================
-- 043_admin_has_identity_from_session.sql — La capacidad es de quien llama
-- ============================================================================
-- CUALQUIERA CON LA CLAVE ANONIMA PODIA PREGUNTAR QUIEN ES DEL EQUIPO.
--
-- `admin_has` recibia a la persona por PARAMETRO:
--
--   create or replace function public.admin_has(
--     capability text, who uuid default auth.uid())
--   security definer
--
-- Es la forma que 042 quito de `admin_resolve_approval`, y 042 dejo esta
-- apuntada como pendiente. Aqui no habia escalada: las cuatro politicas RLS que
-- la usan llaman con un argumento, y el unico llamante con dos
-- —`admin_resolve_approval`, desde 042— le pasa `auth.uid()`. Lo que habia era
-- una fuga: con `security definer` y EXECUTE abierto, la funcion contesta por
-- el uuid que se le mande.
--
-- Comprobado contra la base viva, sin sesion y con un uuid inventado:
--
--   POST /rest/v1/rpc/admin_has  {"capability":"audit.view","who":"<uuid>"}
--   → 200 false
--
-- No rebota en la puerta: entra y contesta. Reproducido sobre una base con 013,
-- 016, 017 y 042, el mismo `who` con el uuid de un miembro del equipo contesta
-- `true`, y la pregunta se repite por cada capacidad. Tampoco hacia falta ir
-- sin sesion: `authenticated` tiene EXECUTE, asi que cualquier cliente con
-- cuenta podia hacer lo mismo. Revocar sin quitar el parametro solo cambiaba
-- quien pregunta.
--
-- LA CORRECCION
--
-- 1. Desaparece el parametro. La identidad se deriva DENTRO, de `auth.uid()`.
--    Sin sesion es null y la respuesta es `false`.
-- 2. Se revoca EXECUTE de PUBLIC y de `anon`; la invoca `authenticated`.
-- 3. `admin_resolve_approval` pasa a llamarla con un argumento.
--
-- QUITAR UN PARAMETRO OBLIGA A TOCAR TODO LO QUE LA NOMBRA
--
-- `create or replace` no puede quitarlo; hace falta el drop. Y el drop lo
-- frenan las cuatro politicas, que dependen de la firma por su oid:
--
--   audit readable by viewers        admin_audit_log          audit.view
--   pending readable by admins       admin_pending_approvals  dashboard.view
--   annotations readable by team     work_annotations         works.view
--   observability readable by team   provider_events          observability.view
--
-- Se borran y se recrean identicas. Sin `cascade`, a proposito: si algo mas
-- depende de la firma vieja, el drop falla y no cambia nada.
--
-- Lo que el drop NO frena es un cuerpo plpgsql. Postgres no registra que
-- `admin_resolve_approval` llama a `admin_has('approve_high_risk', approver)`:
-- la firma vieja se borra sin una queja y la aprobacion falla despues, al
-- usarse, con «function public.admin_has(unknown, uuid) does not exist».
-- Reproducido. Por eso se reescribe aqui, y por eso lo primero es comprobar
-- que ninguna otra funcion de la base la nombra: el esquema base no esta en el
-- repositorio y desde aqui no se puede descartar. Si aparece una, la migracion
-- se niega a seguir. (Tambien se niega si 042 no se aplico: la version de tres
-- argumentos la nombra.)
--
-- Todo va en una transaccion. Entre el drop y el create las cuatro tablas no
-- tienen politica de lectura y aprobar no funciona; ese estado no se publica.
--
-- LA REVOCACION, Y QUE CAMBIA CON ELLA
--
-- Una politica se evalua con el rol de quien consulta, y ese rol necesita
-- EXECUTE sobre lo que la politica llama. Sin el, una lectura anonima de estas
-- cuatro tablas deja de devolver cero filas y devuelve «permission denied for
-- function admin_has». Hoy la base viva contesta `200 []` a esa lectura en las
-- cuatro.
--
-- Ningun camino anonimo las lee. En tbt-cafe y en el backend que sigue en pie
-- (`brocha`, repo `tbt`) toda lectura va por el cliente service-role, que se
-- salta la RLS y no evalua la politica. El cliente anonimo del navegador no las
-- nombra, y ningun repositorio define vistas, suscripciones realtime ni
-- embebidos de PostgREST sobre ellas. Solo nota el cambio quien fabrique esa
-- peticion a mano: recibe un error en vez de una lista vacia.
--
-- Con el parametro fuera, a `anon` no le queda nada que averiguar: sin sesion
-- la respuesta es siempre `false`. La revocacion no tapa la fuga —eso lo hace
-- el punto 1—: le quita una funcion `security definer` a un rol que no la
-- necesita, como hicieron 020, 026 y 042. Revocar de PUBLIC no basta: los
-- privilegios por defecto de Supabase conceden EXECUTE a `anon` por nombre.
-- ============================================================================

begin;

-- Un cuerpo plpgsql o sql no deja rastro en pg_depend, asi que los llamantes se
-- buscan por nombre. La unica funcion que puede nombrarla es la que se
-- reescribe mas abajo.
do $$
declare
  others text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into others
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and strpos(p.prosrc, 'admin_has') > 0
     and p.oid is distinct from to_regprocedure('public.admin_resolve_approval(uuid, text)');

  if others is not null then
    raise exception 'admin_has tiene llamantes que esta migracion no reescribe: %', others;
  end if;
end;
$$;

drop policy if exists "audit readable by viewers" on public.admin_audit_log;
drop policy if exists "pending readable by admins" on public.admin_pending_approvals;
drop policy if exists "annotations readable by team" on public.work_annotations;
drop policy if exists "observability readable by team" on public.provider_events;

-- Sin cascade: si algo mas depende de la firma vieja, que falle aqui.
drop function if exists public.admin_has(text, uuid);

create or replace function public.admin_has(capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select active and (permissions ->> capability)::boolean
       from public.admin_members where user_id = auth.uid()),
    false
  );
$$;

-- Postgres concede EXECUTE a PUBLIC al crear la funcion, y Supabase ademas a
-- `anon` por nombre. `authenticated` lo necesita: evalua las politicas.
revoke execute on function public.admin_has(text) from public;
revoke execute on function public.admin_has(text) from anon;
grant execute on function public.admin_has(text) to authenticated;

comment on function public.admin_has(text) is
  '¿Tiene quien llama esta capacidad? La identidad sale de auth.uid() DENTRO: cuando venia por parametro, se podia preguntar por cualquier uuid. De ella dependen las politicas de lectura de admin_audit_log, admin_pending_approvals, work_annotations y provider_events.';

create policy "audit readable by viewers" on public.admin_audit_log
  for select using (public.admin_has('audit.view'));
create policy "pending readable by admins" on public.admin_pending_approvals
  for select using (public.admin_has('dashboard.view'));
create policy "annotations readable by team" on public.work_annotations
  for select using (public.admin_has('works.view'));
create policy "observability readable by team" on public.provider_events
  for select using (public.admin_has('observability.view'));

-- El cuerpo de 042, con la llamada a admin_has en un argumento. `create or
-- replace` conserva el oid, asi que el revoke, el grant y el comentario de 042
-- siguen en pie.
create or replace function public.admin_resolve_approval(
  approval_id uuid,
  decision text
)
returns public.admin_pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.admin_pending_approvals;
  approver uuid := auth.uid();
begin
  -- Sin sesion no hay a quien atribuir la aprobacion. Antes se podia entrar
  -- aqui con la clave anonima y nombrar a cualquiera.
  if approver is null then
    raise exception 'no session';
  end if;

  if decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  -- admin_has pregunta por auth.uid(), que aqui es `approver`.
  if not public.admin_has('approve_high_risk') then
    raise exception 'approver lacks approve_high_risk';
  end if;

  select * into row from public.admin_pending_approvals where id = approval_id for update;
  if not found then
    raise exception 'approval not found';
  end if;
  if row.status <> 'pending' then
    raise exception 'approval is already %', row.status;
  end if;
  -- Caducada es una negativa, y se dice como tal. Devolver la fila hacia que la
  -- ruta contestase 200 y anotase una aprobacion que no ocurrio.
  if row.expires_at < now() then
    raise exception 'approval expired at %', row.expires_at;
  end if;
  if row.initiator_id = approver then
    raise exception 'the approver cannot be the initiator';
  end if;

  update public.admin_pending_approvals
     set status = decision, approver_id = approver, resolved_at = now()
   where id = approval_id
  returning * into row;

  return row;
end;
$$;

-- admin_resolve_approval es security definer: llama a admin_has con los
-- permisos de su propietario, no con los de quien aprueba. Quitado EXECUTE a
-- PUBLIC, ese propietario tiene que conservarlo o ninguna aprobacion sale.
do $$
begin
  if not has_function_privilege(
    (select proowner from pg_proc where oid = 'public.admin_resolve_approval(uuid, text)'::regprocedure),
    'public.admin_has(text)',
    'execute'
  ) then
    raise exception 'el propietario de admin_resolve_approval no puede ejecutar admin_has(text)';
  end if;
end;
$$;

commit;
