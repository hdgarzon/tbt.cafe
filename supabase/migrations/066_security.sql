-- ============================================================================
-- 066 · Security and velocity — Work Order 02, Stage 10
-- ============================================================================
--
-- 10.1  Protecting the factors (46). "own credentials" was `for all`: with a
--       session alone, the browser could insert a biometric credential of its
--       choosing — never verified by the server — and delete the real ones.
--       That made the second factor something a stolen session could replace.
--       The browser now only reads its credentials; the server enrolls them
--       (after verifying the attestation) and removes them (after the private
--       code).
--
-- 10.2  The phone number change (47): at most one per phone_change_days,
--       counted from phone_changed_at.
--
-- 10.4  Velocity (M16): a new sender-recipient pair above the threshold is
--       held for review. An operator releases it (valid for 48 hours) or
--       declines it with a reason.
-- ============================================================================

drop policy if exists "own credentials" on public.webauthn_credentials;
drop policy if exists "own credentials read" on public.webauthn_credentials;
create policy "own credentials read" on public.webauthn_credentials
  for select using (user_id = (select auth.uid()));
revoke insert, update, delete on public.webauthn_credentials from anon, authenticated;

alter table public.profiles
  add column if not exists phone_changed_at timestamptz,
  -- El numero nuevo que el primer paso autorizo (codigo + biometrico). El
  -- segundo paso solo confirma ESE numero, y solo durante 10 minutos.
  add column if not exists phone_change_pending text,
  add column if not exists phone_change_pending_at timestamptz,
  -- El hecho que anuncia la alarma: un id por cambio, nunca un momento.
  add column if not exists phone_change_pending_id uuid;

create table if not exists public.velocity_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('purchase', 'offer_accept', 'transfer_initiate')),
  amount numeric(12,2),
  work_id uuid references public.works(id) on delete set null,
  counterparty_id uuid references auth.users(id) on delete set null,
  status text not null default 'held' check (status in ('held', 'released', 'declined', 'used')),
  reason text,
  ticket_ref text,
  released_at timestamptz,
  release_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists velocity_holds_user_idx on public.velocity_holds (user_id, status, created_at desc);

alter table public.velocity_holds enable row level security;

drop policy if exists "own holds read" on public.velocity_holds;
create policy "own holds read" on public.velocity_holds
  for select using (user_id = (select auth.uid()));
revoke insert, update, delete on public.velocity_holds from anon, authenticated;
