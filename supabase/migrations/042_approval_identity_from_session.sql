-- ============================================================================
-- 042_approval_identity_from_session.sql — Quien aprueba es quien llama
-- ============================================================================
-- LA REGLA DE DOS PERSONAS LA PODIA CUMPLIR UNA SOLA.
--
-- `admin_resolve_approval` recibia a quien aprueba como PARAMETRO:
--
--   create or replace function public.admin_resolve_approval(
--     approval_id uuid, decision text, approver uuid default auth.uid())
--   security definer
--
-- El valor por defecto es `auth.uid()`, y por eso desde la aplicacion se
-- comportaba bien: la ruta nunca manda el tercer argumento. Pero el defecto
-- solo se aplica cuando NADIE lo manda, y las tres comprobaciones de identidad
-- miraban el parametro en lugar de la sesion:
--
--   :172  if not public.admin_has('approve_high_risk', approver)
--   :190  if row.initiator_id = approver
--   :195  set approver_id = approver
--
-- Asi que bastaba con mandarlo. Quien iniciara una solicitud podia resolverla
-- el mismo nombrando a un colega con `approve_high_risk`: las tres pasaban
-- —el colega tiene la capacidad, el colega no es el iniciador— y la fila
-- quedaba aprobada con el nombre de otra persona. Despues `gateHighRisk` la
-- ejecuta sin objetar, porque solo exige que approver_id sea distinto de quien
-- ejecuta, no que esa persona haya aprobado nada.
--
-- PEOR: LA FUNCION ESTABA ABIERTA
--
-- Postgres concede EXECUTE a PUBLIC al crear una funcion, y en este esquema no
-- habia un solo `revoke execute`. Con `security definer` eso significa que la
-- funcion se podia invocar por PostgREST con la clave anonima. Comprobado
-- contra la base viva: una peticion sin sesion alguna no rebota en la puerta,
-- entra y devuelve el error de dentro —«approver lacks approve_high_risk»—,
-- que solo se alcanza tras pasar la unica comprobacion de permisos que habia.
--
-- Las defensas de la ruta —`can(admin, 'approve_high_risk')` y el step-up— se
-- rodean llamando al RPC directamente. Es exactamente lo que la cabecera de
-- `approvals/route.ts` decia estar evitando: «una comprobacion en la ruta se
-- puede rodear llamando a otra, una en la funcion no». La idea era correcta; la
-- funcion se fiaba de un argumento.
--
-- LA CORRECCION
--
-- 1. Desaparece el parametro. La identidad se deriva DENTRO, de `auth.uid()`,
--    que no se puede falsificar porque lo firma el token. Sin sesion, lanza.
-- 2. Se revoca EXECUTE de PUBLIC y de `anon`; solo `authenticated` la invoca.
-- 3. Caducada deja de responder que si. La rama de caducidad devolvia la fila
--    en lugar de lanzar, asi que la ruta no veia error: contestaba 200 con
--    `ok: true` y escribia en la bitacora «approval.approved» por una solicitud
--    que nadie aprobo. Ahora lanza, y el barrido de `sweepExpiredApprovals` es
--    quien marca la fila como corresponde.
--
-- Hay que CAMBIAR LA FIRMA, no solo el cuerpo: `create or replace` no puede
-- quitar un parametro. Por eso el drop explicito de la version de tres.
--
-- La aplicacion no se toca: ya llamaba con dos argumentos.
--
-- PENDIENTE, RELACIONADO Y FUERA DE ESTA MIGRACION: `admin_has(capability, who
-- default auth.uid())` tiene la misma forma —identidad por parametro en una
-- funcion security definer— y tampoco tiene revoke. Sus llamantes son politicas
-- RLS que usan la forma de un argumento, asi que no hay escalada; lo que se
-- puede es preguntar si un uuid cualquiera tiene una capacidad. Se deja aparte
-- para no mezclar una fuga de informacion con el cierre de un agujero, y porque
-- revocarle EXECUTE afecta a como evaluan esas politicas.
-- ============================================================================

drop function if exists public.admin_resolve_approval(uuid, text, uuid);

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

  if not public.admin_has('approve_high_risk', approver) then
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

-- Postgres concede EXECUTE a PUBLIC al crear la funcion. En una funcion
-- `security definer` eso es la puerta abierta que se describe arriba.
revoke execute on function public.admin_resolve_approval(uuid, text) from public;
revoke execute on function public.admin_resolve_approval(uuid, text) from anon;
grant execute on function public.admin_resolve_approval(uuid, text) to authenticated;

comment on function public.admin_resolve_approval(uuid, text) is
  'Resuelve una solicitud de alto riesgo. Quien aprueba se deriva de auth.uid() DENTRO de la funcion: cuando venia por parametro, una sola persona podia cumplir la regla de dos nombrando a un colega.';
