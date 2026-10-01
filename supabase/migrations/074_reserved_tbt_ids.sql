-- ============================================================================
-- 074 · The prototype example IDs are reserved for ever — Chains 01, Stage 10
-- ============================================================================
--
-- The eight example IDs of the prototype appear in screenshots, the Roast and
-- the presentations. A real work must never receive one: it would look like
-- the example, and the example like a real title. They are kept in
-- platform_config.tbt_id_reserved and generate_tbt_id refuses them, alongside
-- the works that already hold an ID.
--
-- The list is the prototype's (the same eight in every version on file);
-- Federico confirms it in 10.2. Adding one later is one array element.
--
-- generate_tbt_id is reproduced from 050 with two changes: it reads the list,
-- and a candidate on it is skipped like a taken one.
-- ============================================================================

alter table public.platform_config
  add column if not exists tbt_id_reserved text[] not null default '{}';

update public.platform_config
   set tbt_id_reserved = array(
         select distinct unnest(tbt_id_reserved || array[
           'AUR4421', 'TWW8803', 'LAV2209', 'TOG1107', 'RRO5501', 'TYC3302', 'ELU7704', 'WLI9901'
         ]::text[])
         order by 1
       )
 where id = true;

create or replace function public.generate_tbt_id(p_work_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_creator_name text;
  v_blocklist text[];
  v_reserved text[];
  v_letters text;
  candidate text;
  attempt int;
begin
  select w.title, coalesce(p.public_alias, p.display_name)
    into v_title, v_creator_name
    from public.works w
    left join public.profiles p on p.id = w.creator_id
   where w.id = p_work_id;

  if not found then
    raise exception 'generate_tbt_id: obra % no encontrada', p_work_id;
  end if;

  select tbt_id_blocklist, tbt_id_reserved
    into v_blocklist, v_reserved
    from public.platform_config
   where id = true;
  v_blocklist := coalesce(v_blocklist, '{}');
  v_reserved := coalesce(v_reserved, '{}');

  -- (a) Titulo, salvo que sea "Untitled" o que la regla no de tres letras.
  if not public.is_untitled_title(v_title) then
    v_letters := public.tbt_id_letters(v_title);
    if v_letters is not null and v_letters = any (v_blocklist) then
      v_letters := null;
    end if;
  end if;

  -- (b) Nombre del creador por la misma regla.
  if v_letters is null then
    v_letters := public.tbt_id_letters(v_creator_name);
    if v_letters is not null and v_letters = any (v_blocklist) then
      v_letters := null;
    end if;
  end if;

  -- (c) Ultimo recurso.
  if v_letters is null then
    v_letters := 'TBT';
  end if;

  for attempt in 1 .. 200 loop
    candidate := v_letters || lpad((floor(random() * 10000))::int::text, 4, '0');
    -- Chains 01, Stage 10: los ejemplos del prototipo no se emiten nunca.
    if not exists (select 1 from public.works where tbt_id = candidate)
       and not (candidate = any (v_reserved)) then
      return candidate;
    end if;
  end loop;
  raise exception 'no quedan IDs libres para %', v_letters;
end;
$$;

revoke execute on function public.generate_tbt_id(uuid) from public, anon, authenticated;
