-- ============================================================================
-- 075 · The payer's balance alarm — Chains 01, Stage 7.2
-- ============================================================================
--
-- 7.2.2  Thresholds in platform_config, edited by operators: warning at about
--        balance_warning_days of registrations at the trailing daily average,
--        never below balance_warning_floor_sol; urgent at about
--        balance_urgent_days, never below balance_urgent_floor_sol. Not secret:
--        the public key reads them like the other rules (058).
--
-- balance_alerts keeps the alert that is open, so each one fires once per
-- crossing and a recovery closes it. Service role only.
--
-- The check is built and callable, not scheduled: the hourly schedule waits on
-- question (s). The Turbo credit balance joins it with Stage 5.1.
-- ============================================================================

alter table public.platform_config
  add column if not exists balance_warning_days integer not null default 14 check (balance_warning_days > 0),
  add column if not exists balance_urgent_days integer not null default 3 check (balance_urgent_days > 0),
  add column if not exists balance_warning_floor_sol numeric not null default 0.5 check (balance_warning_floor_sol >= 0),
  add column if not exists balance_urgent_floor_sol numeric not null default 0.2 check (balance_urgent_floor_sol >= 0);

grant select (balance_warning_days, balance_urgent_days, balance_warning_floor_sol, balance_urgent_floor_sol)
  on public.platform_config to anon, authenticated;

create table if not exists public.balance_alerts (
  id uuid primary key default gen_random_uuid(),
  account text not null default 'payer' check (account in ('payer')),
  level text not null check (level in ('warning', 'urgent')),
  balance_lamports bigint not null,
  threshold_lamports bigint not null,
  fired_at timestamptz not null default now(),
  cleared_at timestamptz
);

create unique index if not exists balance_alerts_one_open
  on public.balance_alerts (account) where cleared_at is null;

alter table public.balance_alerts enable row level security;
revoke all on public.balance_alerts from anon, authenticated;
