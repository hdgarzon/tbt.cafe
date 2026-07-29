-- ============================================================================
-- 006_series.sql — Series: a creator's grouping of their own works
-- ============================================================================
-- Build Spec 02, Decision 1. Additive: a nullable series_id on works plus a
-- work_series table. Ungrouped works surface under the implicit "All series"
-- view in the UI — no row needed for that. Safe to re-run.
-- ============================================================================

create table if not exists public.work_series (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null, -- follows name; unique per creator
  created_at timestamptz not null default now(),
  unique (creator_id, slug)
);

alter table public.works
  add column if not exists series_id uuid references public.work_series(id) on delete set null;

create index if not exists works_series_id_idx on public.works(series_id);

alter table public.work_series enable row level security;

-- Public can READ series (they appear on public creator pages).
drop policy if exists "series readable" on public.work_series;
create policy "series readable" on public.work_series
  for select using (true);

-- Only the creator may write their own series.
drop policy if exists "own series write" on public.work_series;
create policy "own series write" on public.work_series
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);
