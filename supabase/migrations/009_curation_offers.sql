-- ============================================================================
-- 009_curation_offers.sql — Curation (renamed critique) and the offers ledger
-- ============================================================================
-- Build Spec 02, Items 4/5. Curation: three-axis rating + text, public or
-- private, attached to any target by the same stable-ID scheme as favorites.
-- Offers: a lightweight ledger so an offer on a for-sale work and an
-- unsolicited approach on a not-for-sale work are both recorded. Safe to re-run.
-- ============================================================================

-- ---- Curation -----------------------------------------------------------

create table if not exists public.curations (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('creator','series','work','featured')),
  target_id uuid not null,
  technique smallint check (technique between 1 and 5),
  color smallint check (color between 1 and 5),
  meaning smallint check (meaning between 1 and 5),
  body text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists curations_target_idx
  on public.curations(target_type, target_id) where is_public;

alter table public.curations enable row level security;

-- Anyone reads PUBLIC curations; authors read their own private ones.
drop policy if exists "read public or own" on public.curations;
create policy "read public or own" on public.curations
  for select using (is_public or auth.uid() = author_id);

drop policy if exists "write own curation" on public.curations;
create policy "write own curation" on public.curations
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- ---- Offers ---------------------------------------------------------------

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  status text not null default 'open'
    check (status in ('open','accepted','declined','withdrawn','expired')),
  solicited boolean not null default false, -- was the work for sale?
  created_at timestamptz not null default now()
);

alter table public.offers enable row level security;

-- The offerer and the work owner can see the offer.
drop policy if exists "offer parties read" on public.offers;
create policy "offer parties read" on public.offers
  for select using (
    auth.uid() = from_user
    or auth.uid() = (select current_owner_id from public.works w where w.id = work_id)
  );

drop policy if exists "offerer writes" on public.offers;
create policy "offerer writes" on public.offers
  for insert with check (auth.uid() = from_user);
