-- ============================================================================
-- 062 · Holder identity and the anonymous option — Chains 01 Stage 3
-- ============================================================================
--
-- Placed by Work Order 02 §14: it lands before the accept and purchase screens
-- write the naming choice (5.5, 0.8a).
--
-- 3.1  Every acquisition — creation, transfer, sale, restoring — gets a random
--      five-digit code, unique within that work, on its ownership_history row.
--      Never derived from anything: only the register maps it to a person. A
--      returning holder gets a new code with their new index.
--
-- 3.2  The naming choice on the same row. Named: the record carries the public
--      name. Not named: it carries the code. Unnamed is the default, so a path
--      that forgets the choice names nobody.
--
-- WHY PER ACQUISITION. A code shared across a person's holdings would be
-- unmasked everywhere the first time they are named on any one of them.
-- ============================================================================

alter table public.ownership_history
  add column if not exists holder_code integer,
  add column if not exists holder_named boolean not null default false,
  add column if not exists holder_public_name text;

create or replace function public.issue_holder_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate integer;
begin
  -- Whatever the caller sent is replaced: the code is issued here, never chosen.
  loop
    candidate := 10000 + floor(random() * 90000)::integer;
    exit when not exists (
      select 1 from public.ownership_history h where h.work_id = new.work_id and h.holder_code = candidate
    );
  end loop;
  new.holder_code := candidate;
  return new;
end;
$$;

revoke execute on function public.issue_holder_code() from public, anon, authenticated;

drop trigger if exists issue_holder_code on public.ownership_history;
create trigger issue_holder_code
  before insert on public.ownership_history
  for each row execute function public.issue_holder_code();

-- Existing rows: a code each; the creation row is named (the creator's
-- authorship is already public, 3.3); every later row stays unnamed.
do $$
declare
  r record;
  candidate integer;
begin
  for r in select id, work_id from public.ownership_history where holder_code is null order by created_at loop
    loop
      candidate := 10000 + floor(random() * 90000)::integer;
      exit when not exists (
        select 1 from public.ownership_history h where h.work_id = r.work_id and h.holder_code = candidate
      );
    end loop;
    update public.ownership_history set holder_code = candidate where id = r.id;
  end loop;
end;
$$;

update public.ownership_history
   set holder_named = true,
       holder_public_name = owner_name
 where event_type = 'creation' and not holder_named and owner_name is not null;

alter table public.ownership_history
  alter column holder_code set not null,
  drop constraint if exists holder_code_five_digits,
  add constraint holder_code_five_digits check (holder_code between 10000 and 99999),
  drop constraint if exists holder_code_unique_in_work,
  add constraint holder_code_unique_in_work unique (work_id, holder_code),
  drop constraint if exists holder_named_has_name,
  add constraint holder_named_has_name check (not holder_named or holder_public_name is not null);
