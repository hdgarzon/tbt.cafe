-- ============================================================================
-- 080 · Nobody rewrites a transfer from the browser
-- ============================================================================
--
-- The base schema gave `transfers` three write policies:
--
--   "Participantes pueden actualizar transferencias"  for update
--       using (from_owner_id = auth.uid() or to_owner_id = auth.uid())
--   "Propietarios pueden iniciar transferencias"       for insert
--       with check (from_owner_id = auth.uid())
--   "Users can create transfers"                       for insert
--       with check (to_owner_id = auth.uid())
--
-- RLS filters rows, not columns (047 learnt it on notifications). With the anon
-- key and a session, either side of a transfer could PATCH any column of it
-- through PostgREST: sale_price, payment_status, status, outcome, the stored
-- amounts (buyer_total, seller_net, royalty_earning, application_fee),
-- charge_path, holder_named. The insert policies were worse: a buyer could
-- insert a row naming someone else's work and its owner, already `completed`,
-- and /api/complete-transfer would then move the work with the service role.
--
-- No browser code writes `transfers`. Every insert and update is a server
-- route; the two that still wrote through the caller's session
-- (complete-transfer, create-checkout) now use the service role, in the same
-- change. So nothing is granted back: the client roles keep SELECT, under the
-- participants' select policy, and nothing else.
--
-- If the browser ever needs to write a column here, grant UPDATE on that
-- column alone (as 047 does for notifications.read_at), add it to
-- BROWSER_WRITES in scripts/transfers-rls-check.ts, and add a policy for it.
--
-- npm run check:transfersrls holds this.
-- ============================================================================

begin;

drop policy if exists "Participantes pueden actualizar transferencias" on public.transfers;
drop policy if exists "Propietarios pueden iniciar transferencias" on public.transfers;
drop policy if exists "Users can create transfers" on public.transfers;

-- Without a policy RLS already denies these; the privilege goes too, so the
-- table does not depend on nobody adding a policy without thinking.
revoke insert, update, delete on public.transfers from anon, authenticated;

do $$
declare
  c record;
  r text;
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'transfers'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'a write policy is still on public.transfers';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'transfers'
       and policyname = 'Participantes pueden ver transferencias' and cmd = 'SELECT'
  ) then
    raise exception 'the participants lost the select policy on public.transfers';
  end if;

  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.transfers', 'INSERT')
       or has_table_privilege(r, 'public.transfers', 'UPDATE')
       or has_table_privilege(r, 'public.transfers', 'DELETE') then
      raise exception '% still holds a table write privilege on public.transfers', r;
    end if;
  end loop;

  for c in
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'transfers'
  loop
    if has_column_privilege('authenticated', 'public.transfers', c.column_name, 'UPDATE')
       or has_column_privilege('anon', 'public.transfers', c.column_name, 'UPDATE') then
      raise exception 'the client can still rewrite transfers.%', c.column_name;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.transfers', 'SELECT') then
    raise exception 'authenticated can no longer read its transfers';
  end if;
end $$;

commit;
