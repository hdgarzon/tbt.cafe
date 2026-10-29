-- ============================================================================
-- 078 · A refund — Work Order 02, 8.2
-- ============================================================================
--
-- A refund is never automatic. It runs under transactions.refund and the
-- two-person rule, and the database half happens first, in one transaction:
-- the earnings the sale created are cancelled before any money moves. The
-- other order would leave, for as long as Stripe took to answer, a refunded
-- sale whose earnings could still be collected.
--
-- What is cancelled:
--
--   platform path  The sale earning and the royalty earning, if neither has
--                  been collected. If either has, the money is already with
--                  the person and 8.2 records a negative balance against them
--                  (8.3). That table waits on Federico's answer to 8.3, so
--                  until it exists the refund is refused here, before anything
--                  changes, with refund_needs_negative_balance.
--
--   direct path    The seller's money is on their connected account and Stripe
--                  takes the refund from there. The royalty earning is
--                  cancelled if it was not collected, and then (in refunds.ts)
--                  exactly royalty_gross of the application fee goes back to
--                  the seller. If it was collected, nothing is returned.
--
-- A sale with an open dispute is refused: Stripe will not refund a disputed
-- charge, and the earnings would be cancelled for a refund that never happens.
--
-- refund_sale_ledger is idempotent on the transfer. A second call, after a
-- Stripe failure or a retry of the apply step, returns what the first stored.

alter table public.payout_earnings
  add column if not exists cancelled_at timestamptz;

alter table public.payout_earnings
  drop constraint if exists payout_earnings_state_check,
  add constraint payout_earnings_state_check
    check (state = any (array['pending', 'available', 'collected', 'reserved', 'cancelled']));

alter table public.transfers
  add column if not exists refund_state text check (refund_state in ('ledger', 'refunded', 'failed')),
  add column if not exists refund_amount numeric(12,2),
  add column if not exists refund_reason text,
  add column if not exists refund_royalty_cancelled boolean,
  add column if not exists refund_id text,
  add column if not exists refund_fee_reversal_id text,
  add column if not exists refunded_at timestamptz,
  add column if not exists service_fee_refund_id text,
  add column if not exists service_fee_refunded_at timestamptz;

create or replace function public.refund_sale_ledger(p_transfer_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers%rowtype;
  v_earning record;
  v_royalty_cancelled boolean := false;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'transfer_not_found' using errcode = 'P0001';
  end if;

  -- Already through here: return what was stored, change nothing.
  if v_transfer.refund_state is not null then
    return jsonb_build_object(
      'refund_state', v_transfer.refund_state,
      'path', v_transfer.charge_path,
      'amount', v_transfer.refund_amount,
      'royalty_cancelled', v_transfer.refund_royalty_cancelled,
      'royalty_gross', v_transfer.royalty_gross,
      'payment_intent', v_transfer.stripe_payment_intent_id
    );
  end if;

  if v_transfer.value_kind is distinct from 'sale' or v_transfer.charge_path is null
     or v_transfer.payment_status is distinct from 'completed' or v_transfer.stripe_payment_intent_id is null then
    raise exception 'not_a_completed_sale' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.payment_disputes d
     where d.transfer_id = p_transfer_id
       and d.kind = 'dispute'
       and d.status not in ('won', 'lost', 'warning_closed')
  ) then
    raise exception 'refund_disputed' using errcode = 'P0001';
  end if;

  for v_earning in
    select id, source, state from public.payout_earnings
     where source_ref = p_transfer_id
       and source in ('sale', 'royalty')
     for update
  loop
    if v_earning.state in ('pending', 'available') then
      update public.payout_earnings
         set state = 'cancelled', cancelled_at = now()
       where id = v_earning.id;
      if v_earning.source = 'royalty' then
        v_royalty_cancelled := true;
      end if;
    elsif v_earning.state = 'cancelled' then
      null;
    elsif v_transfer.charge_path = 'platform' then
      -- Collected or reserved: 8.3's negative balance, not built yet.
      raise exception 'refund_needs_negative_balance' using errcode = 'P0001';
    end if;
  end loop;

  update public.transfers
     set refund_state = 'ledger',
         refund_amount = v_transfer.sale_price,
         refund_reason = p_reason,
         refund_royalty_cancelled = v_royalty_cancelled
   where id = p_transfer_id;

  return jsonb_build_object(
    'refund_state', 'ledger',
    'path', v_transfer.charge_path,
    'amount', v_transfer.sale_price,
    'royalty_cancelled', v_royalty_cancelled,
    'royalty_gross', v_transfer.royalty_gross,
    'payment_intent', v_transfer.stripe_payment_intent_id
  );
end;
$$;

revoke execute on function public.refund_sale_ledger(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_sale_ledger(uuid, text) to service_role;
