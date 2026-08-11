-- Tickets de soporte — Backend Spec 03.
--
-- La idea central: el ORIGEN de un ticket determina cuánto contexto llega con
-- él. Un humano describe el problema con sus palabras y hay que preguntarle;
-- un ticket de sistema llega completo, porque si la plataforma lo detectó ya
-- sabe los detalles y no se le pide al cliente lo que ya sabemos.

-- Identificadores legibles y estables: HR-4822, no un UUID en la cara del
-- cliente. La secuencia los genera en el servidor, nunca el cliente.
create sequence if not exists public.ticket_ref_seq start 4822;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default 'HR-' || nextval('public.ticket_ref_seq'),

  origin text not null check (origin in ('human', 'system', 'ai_escalation')),
  category text not null check (category in (
    'payments', 'payouts', 'transfers', 'registration', 'authentication', 'other'
  )),
  -- Dos niveles a propósito. Una matriz de prioridades completa no sobrevive al
  -- contacto con un equipo pequeño.
  severity text not null check (severity in ('financial', 'secondary')),
  -- La severidad es INDEPENDIENTE del estado: un payout fallido de $40.000 y una
  -- duda sobre regalías están los dos 'open', y no son lo mismo.
  status text not null default 'open'
    check (status in ('open', 'answered', 'resolved', 'closed')),

  subject text not null,
  body text not null,

  subject_user uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,

  -- Lo que el sistema ya sabe. En los tickets de sistema esto lleva el código
  -- del fallo y la respuesta del proveedor; en los del asistente, la
  -- transcripción, para que nadie tenga que explicar su problema dos veces.
  context jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists tickets_subject_user_idx on public.tickets (subject_user, created_at desc);
-- La cola del equipo (Área 7) saca primero lo financiero.
create index if not exists tickets_queue_idx on public.tickets (severity, status, created_at);

/*
 * Idempotencia de los tickets de sistema.
 *
 * Un payout que reintenta y falla tres veces es UN ticket con tres entradas de
 * contexto, no tres tickets. La deduplicación es por (entidad, evento) mientras
 * siga sin resolverse: el índice es parcial sobre los estados abiertos, así que
 * un fallo nuevo después de cerrar el anterior sí abre uno nuevo.
 */
create unique index if not exists tickets_system_dedupe_idx
  on public.tickets (
    (context->>'entity_type'),
    (context->>'entity_id'),
    (context->>'event_code')
  )
  where origin = 'system' and status in ('open', 'answered');

create table if not exists public.ticket_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_type text not null check (author_type in ('customer', 'team', 'system', 'ai')),
  author_name text not null,
  body text not null,
  -- Nota solo del equipo. Nunca se le muestra al cliente: la política de RLS de
  -- abajo lo impide, no solo la interfaz.
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ticket_replies_ticket_idx on public.ticket_replies (ticket_id, created_at);

alter table public.tickets enable row level security;
alter table public.ticket_replies enable row level security;

-- El cliente ve sus tickets, INCLUIDOS los de sistema: que la plataforma avise
-- de un fallo antes de que lo noten es una decisión de transparencia.
drop policy if exists "own tickets read" on public.tickets;
create policy "own tickets read" on public.tickets
  for select using (auth.uid() = subject_user);

-- Solo puede abrir tickets humanos, y solo a su propio nombre. El origen
-- 'system' y 'ai_escalation' los escribe el service role.
drop policy if exists "own tickets insert" on public.tickets;
create policy "own tickets insert" on public.tickets
  for insert with check (auth.uid() = subject_user and origin = 'human');

drop policy if exists "own replies read" on public.ticket_replies;
create policy "own replies read" on public.ticket_replies
  for select using (
    not internal
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id and t.subject_user = auth.uid()
    )
  );

drop policy if exists "own replies insert" on public.ticket_replies;
create policy "own replies insert" on public.ticket_replies
  for insert with check (
    author_type = 'customer'
    and not internal
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id and t.subject_user = auth.uid()
    )
  );

-- Una respuesta del cliente sobre un ticket 'answered' lo devuelve a 'open'.
create or replace function public.ticket_reply_reopens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_type = 'customer' then
    update public.tickets
       set status = case when status = 'answered' then 'open' else status end,
           updated_at = now()
     where id = new.ticket_id;
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_reply_reopens_trg on public.ticket_replies;
create trigger ticket_reply_reopens_trg
  after insert on public.ticket_replies
  for each row execute function public.ticket_reply_reopens();
