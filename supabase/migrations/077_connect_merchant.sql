-- ============================================================================
-- 077 · The direct path can take a charge — Work Order 02, 0.3a and 0.3c
-- ============================================================================
--
-- A direct-path seller's connected account carries the merchant configuration
-- with card payments requested, beside the recipient configuration it already
-- has. Stripe activates card payments on its own schedule, after the seller
-- completes onboarding, and can withdraw it when it asks for more.
--
-- This column is where the answer is kept: account.updated refreshes it, and
-- create-purchase reads it before sending a sale to that account. Until it is
-- true, a direct-path sale is refused at our door instead of at Stripe's,
-- after the buyer pressed Pay.
--
-- No new grants: payout_connect_accounts is written only by the service role.

alter table public.payout_connect_accounts
  add column if not exists card_payments_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 6.5  The direct-path payout delay is set on the connected account from
--      seller_payout_delay_days. Stripe accepts at most 31 (sandbox, 1 October:
--      31 accepted, 32 refused with "must be less than or equal to 31"). The
--      configuration only checked >= 0, so an operator could store a value
--      Stripe would refuse on every account. The table now refuses it first.
-- ---------------------------------------------------------------------------

alter table public.platform_config
  drop constraint if exists rules_payout_delay_max,
  add constraint rules_payout_delay_max check (seller_payout_delay_days <= 31);
