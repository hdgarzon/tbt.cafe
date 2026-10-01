-- ============================================================================
-- 061 · Offers — Work Order 02, Stage 4.1
-- ============================================================================
--
-- An offer has a chosen duration (24, 48 or 72 hours, never above
-- offer_max_hours), an optional message, and after acceptance a payment window
-- and an automatic cancellation. Every change is logged in offer_events, which
-- nobody edits. The offerer and the current holder read; only the server
-- writes: statuses change through the routes and the sweep, never from a
-- browser.
--
-- A new ticket category, 'report', carries a reported offer message (4.11).
-- ============================================================================

alter table public.offers
  add column if not exists duration_hours integer,
  add column if not exists expires_at timestamptz,
  add column if not exists message text,
  add column if not exists response_message text,
  add column if not exists responded_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists payment_due_at timestamptz,
  add column if not exists auto_cancel_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists close_reason text,
  add column if not exists halfway_reminded_at timestamptz,
  add column if not exists near_reminded_at timestamptz,
  add column if not exists suspended boolean not null default false;

-- Open offers made before durations existed get the default, from now: they
-- are test data, and an expiry in the past would close them on the first sweep.
update public.offers
   set duration_hours = 72,
       expires_at = now() + interval '72 hours'
 where duration_hours is null;

alter table public.offers
  alter column duration_hours set not null,
  alter column expires_at set not null,
  drop constraint if exists offers_status_check,
  add constraint offers_status_check
    check (status in ('open', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled', 'completed')),
  drop constraint if exists offers_duration_check,
  add constraint offers_duration_check check (duration_hours in (24, 48, 72)),
  drop constraint if exists offers_amount_positive,
  add constraint offers_amount_positive check (amount > 0),
  drop constraint if exists offers_message_length,
  add constraint offers_message_length check (
    (message is null or char_length(message) <= 2000) and (response_message is null or char_length(response_message) <= 2000)
  );

create index if not exists offers_sweep_idx on public.offers (status, expires_at) where status in ('open', 'accepted');
create index if not exists offers_work_idx on public.offers (work_id, status);

-- Only the server writes. The parties keep reading through "offer parties read".
drop policy if exists "offerer writes" on public.offers;
revoke insert, update, delete on public.offers from anon, authenticated;

-- ── The log ─────────────────────────────────────────────────────────────────

create table if not exists public.offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  event text not null,
  actor_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists offer_events_offer_idx on public.offer_events (offer_id, created_at);

alter table public.offer_events enable row level security;

drop policy if exists "offer parties read events" on public.offer_events;
create policy "offer parties read events" on public.offer_events
  for select using (
    exists (
      select 1 from public.offers o join public.works w on w.id = o.work_id
       where o.id = offer_events.offer_id
         and ((select auth.uid()) = o.from_user or (select auth.uid()) = w.current_owner_id)
    )
  );

revoke insert, update, delete on public.offer_events from anon, authenticated;

create or replace function public.offer_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'offer_events is append-only' using errcode = 'P0001';
end;
$$;

revoke execute on function public.offer_events_append_only() from public, anon, authenticated;

-- Nobody edits an event. It disappears only with its offer (on delete
-- cascade), which is what the test-data cleanup of Chains 01 Stage 10 does;
-- clients cannot delete either (revoked above).
drop trigger if exists offer_events_append_only on public.offer_events;
create trigger offer_events_append_only
  before update on public.offer_events
  for each row execute function public.offer_events_append_only();

-- ── Reports (4.11) ──────────────────────────────────────────────────────────

alter table public.tickets
  drop constraint if exists tickets_category_check,
  add constraint tickets_category_check
    check (category in ('payments', 'payouts', 'transfers', 'registration', 'authentication', 'other', 'claim', 'report'));
