-- ============================================================================
-- 069 · The credited name, confirmed once — Chains 01, Stage 1.3
-- ============================================================================
--
-- The name a work is credited under goes on its permanent record and cannot
-- be removed. Before the first Seal the creator confirms it or enters an alias;
-- later brews use it without asking. The confirmation time is not private, so
-- the browser may read it (the rest of profiles stays column-granted, 053).
-- ============================================================================

alter table public.profiles
  add column if not exists credited_name_confirmed_at timestamptz;

grant select (credited_name_confirmed_at) on public.profiles to anon, authenticated;
