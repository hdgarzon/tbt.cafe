-- ============================================================================
-- 058 · Configuration becomes the single source — Work Order 02, Stage 1.1
-- ============================================================================
--
-- Every value in §3 becomes a column of platform_config and is read from there
-- by every route (src/lib/rules.ts). Nothing restates a number. Making a value
-- editable without making it the only copy turns a stale page into a false one
-- the moment somebody uses the control (Rules Registry §5).
--
-- Authority (who may change a value) is not stored here: it lives beside the
-- reader, in rules.ts, and the admin config route enforces it (Stage 1.5).
--
-- NEVER IN CONFIGURATION: the card processing rate (Stripe's, fixed in code),
-- and the promises — the royalty lock and its scope, the royalty deducted from
-- proceeds and never added to the buyer's price, ownership never reversed,
-- refunds never automatic, the private code and biometric at collection and at
-- a destination change, the unsilenceable notifications.
--
-- three_ds_threshold stays until Stage 0.6 changes the 3-D Secure rule and the
-- ladder function that reads it (021); three_ds_registration_exempt is added now.
-- ============================================================================

alter table public.platform_config
  -- Fees (Registry §1). Two-person.
  add column if not exists service_fee_buyer numeric(12,2) not null default 8.00,
  add column if not exists service_fee_seller numeric(12,2) not null default 8.00,
  add column if not exists service_fee_royalty numeric(12,2) not null default 8.00,
  add column if not exists registration_fee numeric(12,2) not null default 8.00,
  add column if not exists transfer_fee numeric(12,2) not null default 8.00,

  -- Settlement (73). Operator.
  add column if not exists settlement_days_top integer not null default 30,
  add column if not exists settlement_top_threshold numeric(12,2) not null default 10000,
  add column if not exists first_payout_hold_days integer not null default 30,
  add column if not exists first_payout_clean_sales integer not null default 2,
  add column if not exists first_payout_max_days integer not null default 90,
  add column if not exists absorption_threshold numeric(12,2) not null default 250,
  add column if not exists writeoff_months integer not null default 24,

  -- Royalty (50, D-8). Two-person.
  add column if not exists royalty_pct_ceiling numeric(5,2) not null default 90,
  add column if not exists royalty_pct_warning numeric(5,2) not null default 50,
  add column if not exists royalty_floor_pct numeric(5,2) not null default 10,
  add column if not exists royalty_floor_min numeric(12,2) not null default 50,

  -- Transfers and offers (M13, M9, M10). Operator.
  add column if not exists transfer_window_hours integer not null default 48,
  add column if not exists offer_max_hours integer not null default 72,
  add column if not exists offer_payment_window_hours integer not null default 24,
  add column if not exists offer_auto_cancel_days integer not null default 4,
  add column if not exists offer_near_expiry_fraction numeric(4,3) not null default 0.10,
  add column if not exists offer_message_max integer not null default 500,

  -- Title link (69; Work Order 01 Step 17). Operator.
  add column if not exists title_link_days integer not null default 30,
  add column if not exists title_link_warning_day integer not null default 25,

  -- Velocity (59; 27 Sep) and phone change (47). Operator.
  add column if not exists velocity_count_per_hour integer not null default 3,
  add column if not exists velocity_outbound_24h numeric(12,2) not null default 25000,
  add column if not exists velocity_new_pair_days integer not null default 30,
  add column if not exists velocity_new_pair_threshold numeric(12,2) not null default 5000,
  add column if not exists phone_change_days integer not null default 30,

  -- 3-D Secure (M15). Two-person.
  add column if not exists three_ds_registration_exempt boolean not null default true,

  -- Payouts (Registry §1, M5, M22). Operator.
  add column if not exists payout_cost_bank numeric(12,2) not null default 1.50,
  add column if not exists payout_cost_usdc numeric(12,2) not null default 1.00,
  add column if not exists seller_payout_delay_days integer not null default 7,
  add column if not exists usdc_enabled boolean not null default false,

  -- The scanner (Registry §3; master list A6, D3). Thresholds two-person, the
  -- address operator. The API key stays a secret in the environment.
  add column if not exists scan_warn numeric(4,3) not null default 0.75,
  add column if not exists scan_block numeric(4,3) not null default 0.90,
  add column if not exists scan_processor_url text not null default 'https://tbt-image-processor.fly.dev',

  -- Pause switches (87). Operator. Each with its four-language message, the
  -- defaults from the companion text §4.7.
  add column if not exists pause_registration boolean not null default false,
  add column if not exists pause_registration_message jsonb not null default jsonb_build_object(
    'en', 'Registration is paused for a moment. Everything else works as usual.',
    'es', 'El registro está en pausa por un momento. Todo lo demás funciona con normalidad.',
    'pt', 'O registro está pausado por um momento. O resto funciona normalmente.',
    'fr', 'L''enregistrement est suspendu pour un moment. Tout le reste fonctionne normalement.'),
  add column if not exists pause_selling boolean not null default false,
  add column if not exists pause_selling_message jsonb not null default jsonb_build_object(
    'en', 'Sales are paused for a moment. Offers and transfers work as usual.',
    'es', 'Las ventas están en pausa por un momento. Ofertas y transferencias funcionan con normalidad.',
    'pt', 'As vendas estão pausadas por um momento. Ofertas e transferências funcionam normalmente.',
    'fr', 'Les ventes sont suspendues pour un moment. Les offres et transferts fonctionnent normalement.'),
  add column if not exists pause_offers boolean not null default false,
  add column if not exists pause_offers_message jsonb not null default jsonb_build_object(
    'en', 'Offers are paused for a moment.',
    'es', 'Las ofertas están en pausa por un momento.',
    'pt', 'As ofertas estão pausadas por um momento.',
    'fr', 'Les offres sont suspendues pour un moment.'),
  add column if not exists pause_transfers boolean not null default false,
  add column if not exists pause_transfers_message jsonb not null default jsonb_build_object(
    'en', 'New transfers are paused for a moment. Pending ones can still be accepted.',
    'es', 'Las transferencias nuevas están en pausa por un momento. Las pendientes aún se pueden aceptar.',
    'pt', 'Novas transferências estão pausadas por um momento. As pendentes ainda podem ser aceitas.',
    'fr', 'Les nouveaux transferts sont suspendus pour un moment. Ceux en attente peuvent encore être acceptés.'),
  add column if not exists pause_payouts boolean not null default false,
  add column if not exists pause_payouts_message jsonb not null default jsonb_build_object(
    'en', 'Payout collection is paused for a moment. Your earnings are safe.',
    'es', 'El cobro está en pausa por un momento. Tus ganancias están seguras.',
    'pt', 'Os repasses estão pausados por um momento. Seus ganhos estão seguros.',
    'fr', 'Les versements sont suspendus pour un moment. Vos gains sont en sécurité.');

-- ── Checks ──────────────────────────────────────────────────────────────────

alter table public.platform_config
  drop constraint if exists rules_fees_non_negative,
  add constraint rules_fees_non_negative
    check (service_fee_buyer >= 0 and service_fee_seller >= 0 and service_fee_royalty >= 0 and registration_fee >= 0 and transfer_fee >= 0),
  drop constraint if exists rules_thresholds_non_negative,
  add constraint rules_thresholds_non_negative
    check (settlement_top_threshold >= 0 and absorption_threshold >= 0 and velocity_outbound_24h >= 0
       and velocity_new_pair_threshold >= 0 and payout_cost_bank >= 0 and payout_cost_usdc >= 0
       and royalty_floor_min >= 0 and royalty_floor_pct >= 0),
  drop constraint if exists rules_days_positive,
  add constraint rules_days_positive
    check (settlement_days_top > 0 and first_payout_hold_days >= 0 and first_payout_clean_sales >= 0
       and first_payout_max_days >= first_payout_hold_days and writeoff_months > 0
       and offer_max_hours > 0 and offer_payment_window_hours > 0 and offer_auto_cancel_days > 0
       and offer_message_max > 0 and velocity_count_per_hour > 0 and velocity_new_pair_days >= 0
       and phone_change_days >= 0 and seller_payout_delay_days >= 0),
  drop constraint if exists rules_transfer_window,
  add constraint rules_transfer_window check (transfer_window_hours > 0 and transfer_window_hours < 168),
  drop constraint if exists rules_royalty_ceiling,
  add constraint rules_royalty_ceiling check (royalty_pct_ceiling >= 0 and royalty_pct_ceiling <= 90),
  drop constraint if exists rules_royalty_warning,
  add constraint rules_royalty_warning check (royalty_pct_warning <= royalty_pct_ceiling),
  drop constraint if exists rules_near_expiry,
  add constraint rules_near_expiry check (offer_near_expiry_fraction > 0 and offer_near_expiry_fraction < 1),
  drop constraint if exists rules_scan_fractions,
  add constraint rules_scan_fractions check (scan_warn > 0 and scan_warn <= scan_block and scan_block <= 1),
  drop constraint if exists rules_title_link,
  add constraint rules_title_link check (title_link_warning_day > 0 and title_link_warning_day < title_link_days),
  drop constraint if exists rules_scan_url,
  add constraint rules_scan_url check (scan_processor_url ~ '^https://'),
  drop constraint if exists rules_pause_registration_message,
  add constraint rules_pause_registration_message check (pause_registration_message ?& array['en', 'es', 'pt', 'fr']),
  drop constraint if exists rules_pause_selling_message,
  add constraint rules_pause_selling_message check (pause_selling_message ?& array['en', 'es', 'pt', 'fr']),
  drop constraint if exists rules_pause_offers_message,
  add constraint rules_pause_offers_message check (pause_offers_message ?& array['en', 'es', 'pt', 'fr']),
  drop constraint if exists rules_pause_transfers_message,
  add constraint rules_pause_transfers_message check (pause_transfers_message ?& array['en', 'es', 'pt', 'fr']),
  drop constraint if exists rules_pause_payouts_message,
  add constraint rules_pause_payouts_message check (pause_payouts_message ?& array['en', 'es', 'pt', 'fr']);

-- The guard reads each of these by the exact form above; keep them literal:
--   check (transfer_window_hours > 0 and transfer_window_hours < 168)
--   check (royalty_pct_ceiling >= 0 and royalty_pct_ceiling <= 90)
--   check (royalty_pct_warning <= royalty_pct_ceiling)
--   check (scan_warn > 0 and scan_warn <= scan_block and scan_block <= 1)
--   check (offer_near_expiry_fraction > 0 and offer_near_expiry_fraction < 1)

-- ── Who reads what ──────────────────────────────────────────────────────────
--
-- The table is readable by anyone (011): the browser needs the fees, the
-- windows and the pause messages. The scanner's address is not the browser's
-- business, so the public key reads every column but that one. RLS filters
-- rows, not columns (053): the column list is the only way to hold one back.

revoke select on public.platform_config from anon, authenticated;
grant select (
  id, covered_brews_enabled, covered_brews_count, updated_at,
  settlement_days_standard, settlement_days_high, settlement_high_threshold,
  payout_platform_pct, biometric_threshold, three_ds_threshold, tbt_id_blocklist,
  service_fee_buyer, service_fee_seller, service_fee_royalty, registration_fee, transfer_fee,
  settlement_days_top, settlement_top_threshold,
  first_payout_hold_days, first_payout_clean_sales, first_payout_max_days,
  absorption_threshold, writeoff_months,
  royalty_pct_ceiling, royalty_pct_warning, royalty_floor_pct, royalty_floor_min,
  transfer_window_hours, offer_max_hours, offer_payment_window_hours, offer_auto_cancel_days,
  offer_near_expiry_fraction, offer_message_max,
  title_link_days, title_link_warning_day,
  velocity_count_per_hour, velocity_outbound_24h, velocity_new_pair_days, velocity_new_pair_threshold,
  phone_change_days, three_ds_registration_exempt,
  payout_cost_bank, payout_cost_usdc, seller_payout_delay_days, usdc_enabled,
  scan_warn, scan_block,
  pause_registration, pause_registration_message, pause_selling, pause_selling_message,
  pause_offers, pause_offers_message, pause_transfers, pause_transfers_message,
  pause_payouts, pause_payouts_message
) on public.platform_config to anon, authenticated;
