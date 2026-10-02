-- ============================================================================
-- 073 · The recovery sweep keeps its failures — Chains 01, Stage 7.3 (f)
-- ============================================================================
--
-- Anything the sweep cannot finish is remembered here: which work, which step
-- (seal, move, provenance), which row, since when and why. After 24 hours of
-- failing, one operator ticket names the work and the step; its ref is kept so
-- the next pass does not open a second. A success removes the row.
--
-- The sweep itself is built and callable, not scheduled: its hourly schedule
-- waits on question (s).
-- ============================================================================

create table if not exists public.chain_recovery_failures (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works (id) on delete cascade,
  step text not null check (step in ('seal', 'move', 'provenance')),
  -- The ownership row for move and provenance; the work itself for seal.
  subject_id uuid not null,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  attempts integer not null default 1,
  last_error text,
  ticket_ref text,
  unique (work_id, step, subject_id)
);

alter table public.chain_recovery_failures enable row level security;
revoke all on public.chain_recovery_failures from anon, authenticated;
