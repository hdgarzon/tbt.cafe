-- ============================================================================
-- 060 · The commerce write path and the royalty lock — Work Order 02, Stage 3
-- ============================================================================
--
-- 3.2  Clients read work_commerce and never write it. The policy that let the
--      creator manage commerce forever goes: a collector who owned a work could
--      not list it, and a creator could list a work they had sold. Every write
--      now goes through POST /api/work/commerce, as the current holder.
--
-- 3.3  The royalty locks at the first change of ownership by any method —
--      sale, transfer, gift, restoring (M14). It is locked by a trigger on the
--      ownership_history insert, so it happens in the same transaction as the
--      ownership row in every path, including ones written later. The lock
--      records when, and which ownership row did it (a sale has no transfers
--      row; the history row exists for every method).
--
-- 3.4  The percentage ceiling becomes 0–90. Every existing row satisfies it.
--
-- 3.6  frozen_offer_id: while set, the route refuses every change.
-- ============================================================================

drop policy if exists "Creadores pueden gestionar commerce" on public.work_commerce;
revoke insert, update, delete on public.work_commerce from anon, authenticated;

alter table public.work_commerce
  drop constraint if exists valid_royalty_percentage,
  add constraint valid_royalty_percentage check (
    royalty_type <> 'percentage' or (royalty_value >= 0 and royalty_value <= 90)
  );

alter table public.work_commerce
  add column if not exists royalty_locked_at timestamptz,
  add column if not exists royalty_locked_by uuid references public.ownership_history(id) on delete restrict,
  add column if not exists frozen_offer_id uuid references public.offers(id) on delete set null;

-- ── The lock ────────────────────────────────────────────────────────────────

create or replace function public.lock_royalty(p_work_id uuid, p_event uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.work_commerce
     set royalty_locked = true,
         royalty_locked_at = coalesce(royalty_locked_at, now()),
         royalty_locked_by = coalesce(royalty_locked_by, p_event)
   where work_id = p_work_id;
$$;

revoke execute on function public.lock_royalty(uuid, uuid) from public, anon, authenticated;

create or replace function public.ownership_locks_royalty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_royalty(new.work_id, new.id);
  return new;
end;
$$;

revoke execute on function public.ownership_locks_royalty() from public, anon, authenticated;

drop trigger if exists ownership_locks_royalty on public.ownership_history;
create trigger ownership_locks_royalty
  after insert on public.ownership_history
  for each row
  when (new.sequence_number > 1)
  execute function public.ownership_locks_royalty();

-- A locked royalty never changes, and never unlocks — whoever writes the row.

create or replace function public.work_commerce_royalty_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.royalty_locked and (new.royalty_type is distinct from old.royalty_type or new.royalty_value is distinct from old.royalty_value or not new.royalty_locked) then
    raise exception 'royalty_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.work_commerce_royalty_locked() from public, anon, authenticated;

drop trigger if exists work_commerce_royalty_locked on public.work_commerce;
create trigger work_commerce_royalty_locked
  before update on public.work_commerce
  for each row execute function public.work_commerce_royalty_locked();

-- Works that already changed hands carry a locked royalty from today.
update public.work_commerce c
   set royalty_locked = true,
       royalty_locked_at = coalesce(c.royalty_locked_at, now())
 where not c.royalty_locked
   and exists (select 1 from public.ownership_history h where h.work_id = c.work_id and h.sequence_number > 1);
