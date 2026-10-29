-- ============================================================================
-- 083 · The three chain jobs run every hour — Chains 01, 6.2, 7.2.2 and 7.3
-- ============================================================================
--
-- Question (s) asked whether the hourly chain jobs belong inside Work Order
-- 02's 15-minute sweep or apart. Answered 2 October: apart, hourly, on
-- Supabase Cron through pg_net, the same way as tbt-sweep (064).
--
--   :05  tbt-anchor-upgrade  GET /api/cron/anchor-upgrade   6.2
--   :20  tbt-chain-recovery  GET /api/cron/chain-recovery   7.3
--   :40  tbt-balance-alarm   GET /api/cron/balance          7.2.2
--
-- In that order: the upgrade confirms anchors, the sweep publishes their proof
-- records (7.3 e) and finishes what is half done, and the alarm then reads the
-- balances the sweep spent.
--
-- Like tbt-sweep, neither the address nor the secret is written here: both are
-- read from Vault at run time (app_url, cron_secret, stored once by an
-- operator; see 064). Until both exist the jobs post nowhere and the routes
-- refuse them.
--
-- The daily Vercel entry for the anchor upgrade (vercel.json) stays as a
-- fallback. Vercel Hobby allows one run a day; Supabase is what makes it hourly.
--
-- chain_jobs_scheduled() lets the switch-readiness check (Stage 11.1) confirm
-- the three jobs exist and are active. The cron schema is not exposed to
-- PostgREST, so it reads through this one function, which only the service
-- role may call.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'tbt-anchor-upgrade',
  '5 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/anchor-upgrade',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$);

select cron.schedule(
  'tbt-chain-recovery',
  '20 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/chain-recovery',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$);

select cron.schedule(
  'tbt-balance-alarm',
  '40 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/balance',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $job$);

-- ── what the readiness check reads ──────────────────────────────────────────

create or replace function public.chain_jobs_scheduled()
returns table (jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select j.jobname::text, j.schedule::text, j.active
    from cron.job j
   where j.jobname in ('tbt-anchor-upgrade', 'tbt-chain-recovery', 'tbt-balance-alarm');
$$;

revoke execute on function public.chain_jobs_scheduled() from public, anon, authenticated;
grant execute on function public.chain_jobs_scheduled() to service_role;
