-- ============================================================================
-- 064 · The scheduler, settlement and earnings — Work Order 02, Stage 6
-- ============================================================================
--
-- 6.1  Supabase Cron (M23). One job every 15 minutes POSTs /api/cron/sweep with
--      CRON_SECRET. Neither the address nor the secret is written here: both
--      are read from Supabase Vault at run time, so this file is safe to read
--      and a rotated secret needs no migration. Before the first run, an
--      operator stores them once (SQL editor, service role):
--
--        select vault.create_secret('https://tbt.cafe', 'app_url');
--        select vault.create_secret('<the CRON_SECRET value>', 'cron_secret');
--
--      Until both exist the job posts nowhere and the route refuses it; the
--      daily Vercel anchor upgrade in vercel.json stays as it is.
--
-- 6.2  Three settlement tiers on the sale value (M4). A royalty from a transfer
--      or an accepted offer stays available at once, as the Registry says.
--
-- 6.3  The first-payout hold, platform path only: while a seller is new, a
--      sale earning releases at the later of its tier date and the hold date.
--      New ends at first_payout_clean_sales clean sales, or first_payout_max_days
--      after the first one. Royalties are never held.
--
-- 6.4  A dispute freezes its own money: an earning from a charge with an open
--      dispute cannot enter a payout. The outcome follows Stage 8.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'tbt-sweep',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- ── 6.3 the seller's clean sales ────────────────────────────────────────────

alter table public.seller_accounts
  add column if not exists clean_sales integer not null default 0,
  add column if not exists first_clean_sale_at timestamptz;

-- ── 6.2, 6.3 the release date ───────────────────────────────────────────────

drop function if exists public.payout_release_at(text, numeric, timestamptz);

create or replace function public.payout_release_at(
  p_source text,
  p_sale_amount numeric,
  p_completed_at timestamptz,
  p_seller uuid default null
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_source in ('transfer', 'offer') then null
    else (
      with c as (select * from public.platform_config where id),
      tier as (
        select p_completed_at + make_interval(days => case
          when p_sale_amount > c.settlement_top_threshold then c.settlement_days_top
          when p_sale_amount > c.settlement_high_threshold then c.settlement_days_high
          else c.settlement_days_standard
        end) as at
        from c
      ),
      hold as (
        select case
          when p_source = 'sale' and p_seller is not null and exists (
            select 1
              from public.seller_accounts s, c
             where s.user_id = p_seller
               and s.charge_path = 'platform'
               and s.clean_sales < c.first_payout_clean_sales
               and not (s.first_clean_sale_at is not null
                        and now() >= s.first_clean_sale_at + make_interval(days => c.first_payout_max_days))
          )
          then p_completed_at + make_interval(days => (select c.first_payout_hold_days from c))
        end as at
      )
      select greatest(tier.at, coalesce(hold.at, tier.at)) from tier, hold
    )
  end;
$$;

-- ── 6.4 a dispute freezes its own money ─────────────────────────────────────

create or replace function public.earnings_frozen_by_dispute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'collected' and old.state is distinct from 'collected' and new.source_ref is not null
     and exists (
       select 1 from public.payment_disputes d
        where d.transfer_id = new.source_ref
          and d.kind = 'dispute'
          and d.status not in ('won', 'lost', 'warning_closed')
     ) then
    raise exception 'earnings_disputed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.earnings_frozen_by_dispute() from public, anon, authenticated;

drop trigger if exists earnings_frozen_by_dispute on public.payout_earnings;
create trigger earnings_frozen_by_dispute
  before update on public.payout_earnings
  for each row execute function public.earnings_frozen_by_dispute();
