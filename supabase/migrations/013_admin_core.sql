-- Herramienta de administración: permisos, regla de dos personas y bitácora.
-- Backend Spec 07 §1 y §5.
--
-- Se construye primero esto y no las secciones porque es lo que no se puede
-- añadir después: si la bitácora o la regla de dos personas llegan al final,
-- hay que reconstruir encima cada sección que ya escribía datos.

-- ---------------------------------------------------------------------------
-- §1.1 Permisos como casillas, no como roles.
--
-- Los roles se ven ordenados hasta que la realidad no encaja en ellos y la
-- organización termina inventando "Soporte Plus". Una lista plana de
-- capacidades evita eso y se lee de un vistazo: se ve exactamente qué puede
-- hacer cada persona.
--
-- §1.2 Ver y actuar son casillas distintas. Diagnosticar un problema de cobro y
-- forzar un cobro son privilegios diferentes; una sola casilla por área
-- obligaría a concederlos juntos.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  -- { "tickets.view": true, "payouts.force": false, ... }
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_members enable row level security;

-- Cada quien puede leer lo suyo, para que la interfaz sepa qué mostrar. La
-- escritura es del service role: conceder accesos es de alto riesgo (§1.3).
drop policy if exists "admin reads own membership" on public.admin_members;
create policy "admin reads own membership" on public.admin_members
  for select using (auth.uid() = user_id);

/**
 * ¿Tiene esta persona esta capacidad? Una sola función para que la respuesta
 * sea la misma en todas partes.
 */
create or replace function public.admin_has(capability text, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select active and (permissions ->> capability)::boolean
       from public.admin_members where user_id = who),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- §5 Bitácora: TODA acción de la herramienta queda registrada. No negociable.
--
-- Append-only de verdad, no por disciplina: se revocan update y delete sobre la
-- tabla y además un trigger los bloquea. Ningún administrador puede editar ni
-- borrar entradas, sea cual sea su nivel de permisos.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  actor_name text not null,
  -- Presente en las acciones de dos personas: quién aprobó.
  approver_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  -- Obligatoria en lo de alto riesgo. Texto libre y no un desplegable: el valor
  -- está en lo que alguien elige escribir.
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_entity_idx on public.admin_audit_log (entity_type, entity_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "audit readable by viewers" on public.admin_audit_log;
create policy "audit readable by viewers" on public.admin_audit_log
  for select using (public.admin_has('audit.view'));

create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_update on public.admin_audit_log;
create trigger audit_log_no_update
  before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_is_append_only();

revoke update, delete on public.admin_audit_log from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §1.3 La regla de dos personas.
--
-- Lo de alto riesgo —reembolsar, revertir una venta, forzar o cancelar un
-- cobro, cambiar reglas de negocio, cambiar accesos del equipo— exige dos
-- personas distintas: una inicia y otra aprueba.
--
-- Son acciones irreversibles y son exactamente para lo que serviría una cuenta
-- de administrador comprometida. Con este tamaño de equipo la fricción es
-- pequeña; la exposición que cierra no lo es.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_pending_approvals (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  reason text not null,

  initiator_id uuid not null references auth.users(id),
  approver_id uuid references auth.users(id),

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  -- Una aprobación pendiente no puede quedarse ahí para siempre.
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  -- Quien aprueba NUNCA es quien inicia. En la base, no en la interfaz.
  constraint approver_is_not_initiator check (approver_id is null or approver_id <> initiator_id)
);

create index if not exists admin_pending_status_idx on public.admin_pending_approvals (status, created_at desc);

alter table public.admin_pending_approvals enable row level security;

drop policy if exists "pending readable by admins" on public.admin_pending_approvals;
create policy "pending readable by admins" on public.admin_pending_approvals
  for select using (public.admin_has('dashboard.view'));

/**
 * Resuelve una aprobación pendiente.
 *
 * Comprueba en el servidor las tres condiciones que la interfaz no puede
 * garantizar: que quien aprueba tenga `approve_high_risk`, que no sea quien
 * inició, y que la solicitud siga viva.
 */
create or replace function public.admin_resolve_approval(
  approval_id uuid,
  decision text,
  approver uuid default auth.uid()
)
returns public.admin_pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.admin_pending_approvals;
begin
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
  if row.expires_at < now() then
    update public.admin_pending_approvals
       set status = 'expired', resolved_at = now()
     where id = approval_id
    returning * into row;
    return row;
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
