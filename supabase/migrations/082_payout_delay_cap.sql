-- ============================================================================
-- 082 · The payout delay cap — Work Order 02, Update 01, U7
-- ============================================================================
--
-- seller_payout_delay_days is what Balance Settings receives for a v2
-- connected account. Stop-and-ask 6.5 found that Stripe accepts 7 and refuses
-- anything over 31, so a value above that would save here and fail there.
-- The database refuses it first. The rule writer (api/admin/config) checks
-- only the type and leaves ranges to the database, so this is the only cap.
--
-- rules_days_positive (058) keeps its own >= 0; the cap is a constraint of its
-- own so that 058's literal form, which check:rules reads, stays as it is.
--
-- Before applying in production, the live value must already fit:
--
--   select seller_payout_delay_days from public.platform_config;   -- <= 31
-- ============================================================================

alter table public.platform_config
  drop constraint if exists rules_payout_delay_cap,
  add constraint rules_payout_delay_cap
    check (seller_payout_delay_days >= 0 and seller_payout_delay_days <= 31);

-- The guard reads this by the exact form above; keep it literal:
--   check (seller_payout_delay_days >= 0 and seller_payout_delay_days <= 31)
