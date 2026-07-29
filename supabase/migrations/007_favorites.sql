-- ============================================================================
-- 007_favorites.sql — Favorites keyed by stable IDs
-- ============================================================================
-- Build Spec 02, Decision 3. Keyed on (user_id, target_type, target_id) so
-- renaming a series can never orphan a favorite. Composite PK makes saves
-- idempotent. RLS is own-row. Safe to re-run.
-- ============================================================================

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('creator','series','work')),
  target_id uuid not null, -- profiles.id | work_series.id | works.id
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index if not exists favorites_user_idx on public.favorites(user_id);

alter table public.favorites enable row level security;

drop policy if exists "own favorites" on public.favorites;
create policy "own favorites" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
