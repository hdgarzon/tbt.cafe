-- ============================================================================
-- 008_commerce_featured.sql — Availability, taking-offers, royalty, featured
-- ============================================================================
-- Build Spec 02, Item 1/2. Extends the existing work_commerce (initial_price,
-- currency, is_for_sale) with three availability states, an independent
-- taking-offers flag, an editable+lockable royalty, and a featured marker on
-- works. All additive. Safe to re-run.
--
-- IMPORTANT: is_for_sale STAYS — the live Buy flow and Stripe route read it.
-- Treat `availability` as the source of truth and keep is_for_sale in sync
-- (see the trigger below) so the existing checkout keeps working untouched.
-- ============================================================================

alter table public.work_commerce
  add column if not exists availability text not null default 'not_for_sale'
    check (availability in ('for_sale','reserved','not_for_sale')),
  add column if not exists taking_offers boolean not null default false,
  add column if not exists royalty_pct numeric(5,2) not null default 10,
  add column if not exists royalty_locked boolean not null default false;

-- Keep the legacy is_for_sale column in sync with the richer availability.
create or replace function public.sync_is_for_sale()
returns trigger language plpgsql as $$
begin
  new.is_for_sale := (new.availability = 'for_sale');
  return new;
end;
$$;

drop trigger if exists trg_sync_is_for_sale on public.work_commerce;
create trigger trg_sync_is_for_sale
  before insert or update of availability on public.work_commerce
  for each row execute function public.sync_is_for_sale();

-- Featured: a creator puts a work forward. Boolean + partial index.
alter table public.works
  add column if not exists is_featured boolean not null default false;

create index if not exists works_featured_idx
  on public.works(creator_id) where is_featured;
