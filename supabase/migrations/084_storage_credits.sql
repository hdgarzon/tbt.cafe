-- ============================================================================
-- 084 · The storage key's credits join the balance alarm — Chains 01, 5.1, 7.2.2
-- ============================================================================
--
-- Every Arweave upload is now signed by the storage key and paid from its own
-- credits: Turbo credits (winc) on mainnet, topped up in SOL by the payer; an
-- Irys devnet balance (lamports) on devnet, funded by the storage key itself.
-- When those run out, uploads stop, so the hourly alarm (083) watches them
-- beside the payer's SOL.
--
-- balance_alerts keeps one open alert per account, so 'storage' fires and
-- clears on its own. unit says what balance_lamports and threshold_lamports
-- hold for that row: lamports for the payer and for Irys devnet, winc for
-- Turbo. The column names stay; the rows of the payer are unchanged.
-- ============================================================================

alter table public.balance_alerts
  drop constraint if exists balance_alerts_account_check;

alter table public.balance_alerts
  add constraint balance_alerts_account_check check (account in ('payer', 'storage'));

alter table public.balance_alerts
  add column if not exists unit text not null default 'lamports' check (unit in ('lamports', 'winc'));
