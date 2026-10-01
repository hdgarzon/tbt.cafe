-- ============================================================================
-- 059 · The seller state and the provider countries — Work Order 02, Stage 2
-- ============================================================================
--
-- seller_accounts: one row per person, created on the first visit to Selling.
-- Suspension lives in its own columns so nobody resumes out of one: pausing
-- yourself and being suspended are independent (2.1, 2.7). No delete, ever.
--
-- provider_countries: the single table the charge path and the payout rails
-- come from (2.2). The seller never chooses the path: direct where a full
-- account can take charges, platform otherwise (2.3).
--
-- SEED, from Stripe's published pages for a US platform, fetched 30 Sep 2026:
--
--   merchant     https://stripe.com/global — "Stripe is currently supported in
--                the following countries/regions". 44 countries. IN and ID are
--                "Preview" and left out; the Paystack countries are left out.
--   payout_bank  A full account pays out to its own bank, so every merchant
--                country. Cross-border bank payouts from the platform reach
--                only US, UK, EEA, CA and CH, and never an account under the
--                recipient service agreement:
--                https://docs.stripe.com/connect/cross-border-payouts
--                https://docs.stripe.com/connect/service-agreement-types
--   payout_usdc  https://docs.stripe.com/connect/stablecoin-payouts — 67
--                countries. "Private preview", US platforms only, individuals
--                and sole proprietors only. It counts only while
--                platform_config.usdc_enabled is on (§3), so Stripe's approval
--                is a configuration change, not a deployment.
--
-- Global Payouts (Treasury, money-transmitter licence) is a different product
-- and is not seeded here.
-- ============================================================================

create table if not exists public.provider_countries (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  provider text not null default 'stripe',
  merchant boolean not null default false,
  payout_bank boolean not null default false,
  payout_usdc boolean not null default false,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.provider_countries enable row level security;

-- Anyone may read it: the Selling screen says whether a country is covered.
drop policy if exists "provider countries readable" on public.provider_countries;
create policy "provider countries readable" on public.provider_countries
  for select using (true);

insert into public.provider_countries (country, provider, merchant, payout_bank, payout_usdc, enabled) values
  ('AE', 'stripe', true, true, true, true),
  ('AM', 'stripe', false, false, true, true),
  ('AR', 'stripe', false, false, true, true),
  ('AT', 'stripe', true, true, true, true),
  ('AU', 'stripe', true, true, true, true),
  ('AZ', 'stripe', false, false, true, true),
  ('BE', 'stripe', true, true, true, true),
  ('BG', 'stripe', true, true, true, true),
  ('BH', 'stripe', false, false, true, true),
  ('BJ', 'stripe', false, false, true, true),
  ('BR', 'stripe', true, true, false, true),
  ('CA', 'stripe', true, true, true, true),
  ('CH', 'stripe', true, true, true, true),
  ('CL', 'stripe', false, false, true, true),
  ('CO', 'stripe', false, false, true, true),
  ('CR', 'stripe', false, false, true, true),
  ('CY', 'stripe', true, true, true, true),
  ('CZ', 'stripe', true, true, true, true),
  ('DE', 'stripe', true, true, false, true),
  ('DK', 'stripe', true, true, true, true),
  ('DO', 'stripe', false, false, true, true),
  ('EC', 'stripe', false, false, true, true),
  ('EE', 'stripe', true, true, true, true),
  ('ES', 'stripe', true, true, false, true),
  ('FI', 'stripe', true, true, true, true),
  ('FR', 'stripe', true, true, true, true),
  ('GB', 'stripe', true, true, false, true),
  ('GH', 'stripe', false, false, true, true),
  ('GI', 'stripe', true, true, false, true),
  ('GR', 'stripe', true, true, true, true),
  ('HK', 'stripe', true, true, false, true),
  ('HR', 'stripe', true, true, true, true),
  ('HU', 'stripe', true, true, true, true),
  ('IE', 'stripe', true, true, true, true),
  ('IL', 'stripe', false, false, true, true),
  ('IT', 'stripe', true, true, false, true),
  ('JM', 'stripe', false, false, true, true),
  ('JO', 'stripe', false, false, true, true),
  ('JP', 'stripe', true, true, false, true),
  ('KE', 'stripe', false, false, true, true),
  ('KR', 'stripe', false, false, true, true),
  ('KW', 'stripe', false, false, true, true),
  ('KZ', 'stripe', false, false, true, true),
  ('LI', 'stripe', true, true, true, true),
  ('LK', 'stripe', false, false, true, true),
  ('LT', 'stripe', true, true, true, true),
  ('LU', 'stripe', true, true, true, true),
  ('LV', 'stripe', true, true, true, true),
  ('MN', 'stripe', false, false, true, true),
  ('MT', 'stripe', true, true, true, true),
  ('MU', 'stripe', false, false, true, true),
  ('MX', 'stripe', true, true, true, true),
  ('MY', 'stripe', true, true, true, true),
  ('NL', 'stripe', true, true, true, true),
  ('NO', 'stripe', true, true, true, true),
  ('NZ', 'stripe', true, true, true, true),
  ('PA', 'stripe', false, false, true, true),
  ('PE', 'stripe', false, false, true, true),
  ('PH', 'stripe', false, false, true, true),
  ('PL', 'stripe', true, true, true, true),
  ('PT', 'stripe', true, true, true, true),
  ('PY', 'stripe', false, false, true, true),
  ('RO', 'stripe', true, true, true, true),
  ('SA', 'stripe', false, false, true, true),
  ('SE', 'stripe', true, true, true, true),
  ('SG', 'stripe', true, true, true, true),
  ('SI', 'stripe', true, true, true, true),
  ('SK', 'stripe', true, true, true, true),
  ('SV', 'stripe', false, false, true, true),
  ('TH', 'stripe', true, true, true, true),
  ('TN', 'stripe', false, false, true, true),
  ('US', 'stripe', true, true, true, true),
  ('UY', 'stripe', false, false, true, true),
  ('UZ', 'stripe', false, false, true, true),
  ('ZA', 'stripe', false, false, true, true)
on conflict (country) do nothing;

create table if not exists public.seller_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  status text not null default 'not_applied'
    check (status in ('not_applied', 'pending', 'declined', 'active', 'paused_self')),
  -- Suspension by tbt.cafe, apart from the status: a paused seller who is also
  -- suspended cannot resume, and lifting a suspension restores what was there.
  suspended_at timestamptz,
  suspended_reason text,
  suspended_by uuid references auth.users(id) on delete restrict,
  provider text not null default 'stripe',
  country text references public.provider_countries(country) on delete restrict,
  charge_path text check (charge_path in ('direct', 'platform')),
  entity_type text check (entity_type in ('individual', 'sole_proprietor', 'company', 'institution')),
  applied_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete restrict,
  declined_reason text,
  -- The works that were listed when the seller paused, for the restore sheet.
  remembered_listings uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_suspension_whole check (
    (suspended_at is null and suspended_reason is null and suspended_by is null)
    or (suspended_at is not null and suspended_reason is not null and suspended_by is not null)
  )
);

alter table public.seller_accounts enable row level security;

-- A person reads their own row. Every write goes through the server.
drop policy if exists "sellers read their own" on public.seller_accounts;
create policy "sellers read their own" on public.seller_accounts
  for select using (user_id = (select auth.uid()));

revoke insert, update, delete on public.seller_accounts from anon, authenticated;

-- ── No path lists a work without an active seller (check:seller) ────────────
--
-- Whoever writes work_commerce — the browser today, the commerce route after
-- Stage 3 — a work goes to for_sale only if its current holder is an active,
-- unsuspended seller. Rows already for sale are not touched by this.

create or replace function public.work_commerce_requires_seller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.availability = 'for_sale'
     and (tg_op = 'INSERT' or old.availability is distinct from 'for_sale') then
    if not exists (
      select 1
        from public.works w
        join public.seller_accounts s on s.user_id = w.current_owner_id
       where w.id = new.work_id
         and s.status = 'active'
         and s.suspended_at is null
    ) then
      raise exception 'seller_not_active' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.work_commerce_requires_seller() from public, anon, authenticated;

drop trigger if exists work_commerce_requires_seller on public.work_commerce;
create trigger work_commerce_requires_seller
  before insert or update of availability on public.work_commerce
  for each row execute function public.work_commerce_requires_seller();
