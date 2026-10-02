-- ============================================================================
-- 070 · The work page shows what the records hold — Chains 01, Stage 8
-- ============================================================================
--
-- 8.1  The recording. Brew already hashed the recording on upload and threw the
--      hash away. It is kept now, in the same shape as content_hash, and goes
--      into the registration record. After certification neither the hash nor
--      the file it points at can be changed from the browser.
--
-- 8.2  The asset links. `asset_links` is the live list: the creator edits it
--      while they hold the work, nobody else. `registered_asset_links` is the
--      list as it stood at certification — the copy the registration record
--      carries — and the page labels it "As provided at registration" where the
--      two differ. It is written once, here, and never from the browser.
--
-- WHY A TRIGGER. The update policy on works lets the creator or the current
-- owner write the row. These columns need a narrower rule than that; a policy
-- filters rows, not columns, so the rule is enforced on the column itself. The
-- service role (auth.uid() is null) passes: complete-tbt certifies with it.
-- ============================================================================

alter table public.works
  add column if not exists recording_hash text,
  add column if not exists registered_asset_links text[];

alter table public.works
  drop constraint if exists works_recording_hash_shape,
  add constraint works_recording_hash_shape check (recording_hash is null or recording_hash ~ '^sha256:[0-9a-f]{64}$');

create or replace function public.guard_work_page()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  link text;
begin
  -- Certification freezes the links, whoever certifies.
  if tg_op = 'UPDATE' and new.status = 'certified' and old.status is distinct from 'certified'
     and new.registered_asset_links is null then
    new.registered_asset_links := coalesce(new.asset_links, '{}');
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.registered_asset_links := null;
    return new;
  end if;

  if new.registered_asset_links is distinct from old.registered_asset_links
     and not (new.status = 'certified' and old.status is distinct from 'certified') then
    raise exception 'registered_links_sealed';
  end if;

  if old.status = 'certified'
     and (new.recording_hash is distinct from old.recording_hash or new.audio_video_url is distinct from old.audio_video_url) then
    raise exception 'recording_sealed';
  end if;

  if new.asset_links is distinct from old.asset_links then
    if auth.uid() is distinct from new.creator_id or auth.uid() is distinct from new.current_owner_id then
      raise exception 'links_creator_holder_only';
    end if;
    if coalesce(array_length(new.asset_links, 1), 0) > 20 then
      raise exception 'links_invalid';
    end if;
    foreach link in array coalesce(new.asset_links, '{}') loop
      if link !~ '^https?://' or length(link) > 2000 then
        raise exception 'links_invalid';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_work_page() from public, anon, authenticated;

drop trigger if exists guard_work_page on public.works;
create trigger guard_work_page
  before insert or update on public.works
  for each row execute function public.guard_work_page();

-- Certified works: nobody could edit the links before this, so the live list
-- is the list as registered.
update public.works
   set registered_asset_links = coalesce(asset_links, '{}')
 where status = 'certified' and registered_asset_links is null;
