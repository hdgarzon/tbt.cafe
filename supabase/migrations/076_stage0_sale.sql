-- ============================================================================
-- 076 · The sale, completed in one place — Work Order 02, Stage 0
-- ============================================================================
--
-- 0.3 / 0.4  A sale is charged on one of two paths: on the seller's connected
--            account (direct) or on the platform (platform). The transfer
--            records which, and through which provider.
--
-- 0.9c       The transfer stores the amounts at completion. Receipts (Stage 9)
--            read them and never recompute.
--
-- 0.7a       complete_sale does the database half of a sale in one transaction:
--            the ownership row with the holder's naming choice, the new
--            holder, the royalty lock (060's trigger, on that row), the
--            earnings (royalty; and the sale earning on the platform path), the
--            stored amounts, the offer closed. Idempotent on the transfer: a
--            replayed webhook finds it completed and changes nothing. The chain,
--            the title and the notifications run after it, in completeSale.
--
-- 0.6d       money_action_auth.satisfied_three_ds — dispute evidence (8.1).
-- 0.8b       terms_acceptances — the first purchase accepts the Terms by paying.
-- 0.9a       The buyer's one acknowledgment of the confirmation message.
-- 0.10       Four tax columns on every money row. Zero today; what is owed goes
--            to counsel (§19).
-- ============================================================================

alter table public.transfers
  add column if not exists offer_id uuid references public.offers (id) on delete set null,
  add column if not exists charge_path text check (charge_path in ('direct', 'platform')),
  add column if not exists provider text,
  add column if not exists buyer_total numeric(12,2),
  add column if not exists processing numeric(12,2),
  add column if not exists application_fee numeric(12,2),
  add column if not exists royalty_gross numeric(12,2),
  add column if not exists royalty_earning numeric(12,2),
  add column if not exists platform_take numeric(12,2),
  add column if not exists seller_net numeric(12,2),
  add column if not exists confirmation_acknowledged_at timestamptz,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists tax_party text not null default 'none' check (tax_party in ('buyer', 'seller', 'platform', 'none')),
  add column if not exists tax_country text,
  add column if not exists tax_collected_by text not null default 'none' check (tax_collected_by in ('platform', 'seller', 'provider', 'none'));

alter table public.payout_earnings
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists tax_party text not null default 'none' check (tax_party in ('buyer', 'seller', 'platform', 'none')),
  add column if not exists tax_country text,
  add column if not exists tax_collected_by text not null default 'none' check (tax_collected_by in ('platform', 'seller', 'provider', 'none'));

alter table public.payout_blocks
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists tax_party text not null default 'none' check (tax_party in ('buyer', 'seller', 'platform', 'none')),
  add column if not exists tax_country text,
  add column if not exists tax_collected_by text not null default 'none' check (tax_collected_by in ('platform', 'seller', 'provider', 'none'));

alter table public.tbt_payments
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists tax_party text not null default 'none' check (tax_party in ('buyer', 'seller', 'platform', 'none')),
  add column if not exists tax_country text,
  add column if not exists tax_collected_by text not null default 'none' check (tax_collected_by in ('platform', 'seller', 'provider', 'none'));

alter table public.money_action_auth
  add column if not exists satisfied_three_ds boolean;

create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transfer_id uuid references public.transfers (id) on delete set null,
  terms_version text not null,
  accepted_at timestamptz not null default now()
);
create index if not exists terms_acceptances_user_idx on public.terms_acceptances (user_id);
alter table public.terms_acceptances enable row level security;
revoke all on public.terms_acceptances from anon, authenticated;

-- A legacy trigger from the base schema: on status → 'completed' it moved the
-- owner by itself and inserted into `alerts`, which 031 dropped. Every update
-- that completed a transfer would fail on it; complete_sale does that update.
-- The owner moves inside complete_sale, with its ownership row.
drop trigger if exists trigger_complete_transfer on public.transfers;
drop function if exists public.complete_transfer();

-- ── 0.7a ────────────────────────────────────────────────────────────────────
-- p_amounts: buyer_total, processing, application_fee, royalty_gross,
-- royalty_earning, platform_take, seller_net (numbers), charge_path,
-- provider, payment_intent (text). Returns { history_id, completed }:
-- `completed` is true only for the call that completed the sale. Two
-- deliveries of one event can both get here; the row lock makes the second
-- wait and find it done, and it must not move the token a second time.
create or replace function public.complete_sale(p_transfer uuid, p_amounts jsonb, p_three_ds boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers%rowtype;
  v_work public.works%rowtype;
  v_history uuid;
  v_sequence integer;
  v_name text;
  v_named boolean;
  v_now timestamptz := now();
  v_price numeric;
begin
  select * into v_transfer from public.transfers where id = p_transfer for update;
  if not found then
    raise exception 'complete_sale: transfer % not found', p_transfer;
  end if;

  -- A replay finds it done and changes nothing.
  if v_transfer.payment_status = 'completed' then
    select id into v_history from public.ownership_history where transfer_id = p_transfer;
    return jsonb_build_object('history_id', v_history, 'completed', false);
  end if;

  select * into v_work from public.works where id = v_transfer.work_id for update;
  if v_work.current_owner_id is distinct from v_transfer.from_owner_id then
    raise exception 'complete_sale: the work changed hands since this sale started';
  end if;

  v_price := coalesce(v_transfer.sale_price, 0);
  select count(*) + 1 into v_sequence from public.ownership_history where work_id = v_transfer.work_id;
  select coalesce(public_alias, display_name, 'Unknown') into v_name from public.profiles where id = v_transfer.to_owner_id;
  v_named := coalesce(v_transfer.holder_named, false);

  -- The ownership row. 060's trigger locks the royalty on it; 062's issues the code.
  insert into public.ownership_history (
    work_id, owner_name, owner_user_id, event_type, previous_owner_name, transfer_type,
    price, currency, sequence_number, transfer_id, holder_named, holder_public_name
  ) values (
    v_transfer.work_id, coalesce(v_name, 'Unknown'), v_transfer.to_owner_id, 'transfer', null, 'sale',
    v_price, 'USD', v_sequence, v_transfer.id, v_named, case when v_named then v_name end
  ) returning id into v_history;

  update public.works
     set current_owner_id = v_transfer.to_owner_id, transferred_at = v_now
   where id = v_transfer.work_id;

  -- The new holder decides whether to sell again; an accepted offer is over.
  update public.work_commerce
     set availability = 'not_for_sale', taking_offers = false, frozen_offer_id = null
   where work_id = v_transfer.work_id;

  -- The royalty earning, as before: the creator, never on their own sale.
  if (p_amounts->>'royalty_earning')::numeric > 0 and v_work.creator_id is distinct from v_transfer.from_owner_id then
    insert into public.payout_earnings (user_id, source, work_id, source_ref, amount, state, releases_at, hold_reason)
    values (
      v_work.creator_id, 'royalty', v_transfer.work_id, v_transfer.id,
      (p_amounts->>'royalty_earning')::numeric, 'pending',
      public.payout_release_at('royalty', v_price, v_now), 'settlement_window'
    )
    on conflict do nothing;
  end if;

  -- 0.4b: on the platform path the seller's net is a sale earning.
  if p_amounts->>'charge_path' = 'platform' and (p_amounts->>'seller_net')::numeric > 0 then
    insert into public.payout_earnings (user_id, source, work_id, source_ref, amount, state, releases_at, hold_reason)
    values (
      v_transfer.from_owner_id, 'sale', v_transfer.work_id, v_transfer.id,
      (p_amounts->>'seller_net')::numeric, 'pending',
      public.payout_release_at('sale', v_price, v_now, v_transfer.from_owner_id), 'settlement_window'
    )
    on conflict do nothing;
  end if;

  -- 0.9c: the amounts, stored once.
  update public.transfers
     set status = 'completed',
         payment_status = 'completed',
         completed_at = v_now,
         payment_reference = coalesce(p_amounts->>'payment_intent', payment_reference),
         stripe_payment_intent_id = coalesce(p_amounts->>'payment_intent', stripe_payment_intent_id),
         charge_path = p_amounts->>'charge_path',
         provider = p_amounts->>'provider',
         buyer_total = (p_amounts->>'buyer_total')::numeric,
         processing = (p_amounts->>'processing')::numeric,
         application_fee = nullif(p_amounts->>'application_fee', '')::numeric,
         royalty_gross = (p_amounts->>'royalty_gross')::numeric,
         royalty_earning = (p_amounts->>'royalty_earning')::numeric,
         platform_take = (p_amounts->>'platform_take')::numeric,
         seller_net = (p_amounts->>'seller_net')::numeric
   where id = v_transfer.id;

  -- The accepted offer this sale paid, if any.
  if v_transfer.offer_id is not null then
    update public.offers
       set status = 'completed', closed_at = v_now, close_reason = 'paid'
     where id = v_transfer.offer_id and status = 'accepted';
  end if;

  -- 0.6d: the buyer's last purchase authorisation for this work.
  update public.money_action_auth
     set satisfied_three_ds = p_three_ds
   where id = (
     select id from public.money_action_auth
      where user_id = v_transfer.to_owner_id and work_id = v_transfer.work_id and action = 'purchase'
      order by created_at desc limit 1
   );

  return jsonb_build_object('history_id', v_history, 'completed', true);
end;
$$;

revoke execute on function public.complete_sale(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.complete_sale(uuid, jsonb, boolean) to service_role;
