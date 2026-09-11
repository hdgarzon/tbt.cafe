-- ============================================================================
-- 045_tbt_id_short_form.sql — El ID de una obra: tres letras y cuatro digitos
-- ============================================================================
-- Work Order 01, Stage 2 (Steps 3, 4 y 5).
--
-- EL FORMATO LARGO ERA UN ERROR, NO UNA ALTERNATIVA
--
-- El formato especificado es RRO5501: tres letras sacadas del titulo y cuatro
-- digitos. Produccion emitia el largo —la palabra TBT, el año y seis caracteres
-- de un MD5 aleatorio—, añadido por error y fijado despues con un constraint. No
-- es estetica: la direccion corta que lleva el codigo del titulo cabe en un QR de
-- 29 modulos con correccion H; la larga necesita 37, dos versiones mas, y al
-- tamaño que tiene en el titulo deja de escanear.
--
-- DE DONDE SALIA
--
-- No de la app. La obra se crea en un solo sitio (brew-data.ts) y ese insert no
-- manda tbt_id: lo pone el trigger trigger_set_tbt_id, BEFORE INSERT, que llama a
-- set_tbt_id(), que llama a generate_tbt_id(). Lo que cambia es esa cadena.
--
-- LA REGLA DE LAS LETRAS
--
-- El prototipo no tiene generador: trae ocho ejemplos. Esta regla reproduce los
-- ocho, y la migracion se niega a confirmar si deja de hacerlo:
--
--   tres palabras o mas          las iniciales          The Weeping Woman -> TWW
--   dos, la primera de 1 o 2     esas + la inicial      El Umbral         -> ELU
--   dos, la primera mas larga    inicial + dos letras   Raices Rojas      -> RRO
--   una palabra                  sus tres primeras      Aurora            -> AUR
--
-- Lo que va tras la primera coma no cuenta (Aurora, No. 4), las tildes se quitan
-- y solo cuentan letras latinas. Si faltan, se completa con X: un titulo hecho
-- solo de digitos da XXX. PENDIENTE DE CONFIRMAR con quien especifico el formato;
-- cambiar la regla es cambiar tbt_id_letters y los ejemplos del final, nada mas.
--
-- Los cuatro digitos son aleatorios, y un ID no se reasigna nunca despues.
--
-- POR QUE EL TRIGGER CORRE COMO PROPIETARIO
--
-- El insert lo hace el navegador con el rol authenticated, y la comprobacion de
-- que un ID esta libre corria con ese rol: con la RLS de works solo ve las obras
-- certificadas y las suyas. Con seis caracteres hexadecimales daba igual; con
-- diez mil numeros por combinacion de letras, un ID ocupado por el borrador de
-- otra persona pasaria por libre y el insert moriria en el unique. set_tbt_id es
-- security definer para ver la tabla entera. Es una funcion de trigger: no se
-- puede invocar por RPC, y check:grants la exime por eso.
--
-- LAS OBRAS QUE YA EXISTEN
--
-- Cada una recibe un ID nuevo y guarda el anterior en legacy_tbt_id, que es lo que
-- usan /work, /og y la API del ledger para que los enlaces ya compartidos sigan
-- llegando. work_amendments guarda su propia copia del ID y se actualiza con la
-- obra.
--
-- Los registros ya publicados en la cadena llevan el ID anterior por dentro y no
-- se pueden editar; amend.ts impide ademas cambiar tbt_id en una correccion. Es
-- legacy_tbt_id lo que los une a la obra.
--
-- Todo en una transaccion. Se comprueba a si misma antes de confirmar.
-- ============================================================================

begin;

-- 1. Las letras.
create or replace function public.tbt_id_letters(p_title text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  words text[];
  a text;
  b text;
  s text;
begin
  select array_agg(t.m[1] order by t.ord)
    into words
    from regexp_matches(
           upper(translate(split_part(coalesce(p_title, ''), ',', 1),
             'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳ',
             'AAAAAACEEEEIIIINOOOOOUUUUYAAAAAACEEEEIIIINOOOOOUUUUYYAAAAAACCCCCCCCDDEEEEEEEEEEGGGGGGGGHHIIIIIIIIIJJKKLLLLLLNNNNNNOOOOOORRRRRRSSSSSSSSTTTTUUUUUUUUUUUUWWYYYZZZZZZOOUUAAIIOOUUUUUUUUUUAAAAGGKKOOOOJGGNNAAAAAAEEEEIIIIOOOORRRRUUUUSSTTHHAAEEOOOOOOOOYY')),
           '([A-Z]+)', 'g'
         ) with ordinality as t(m, ord);

  if words is null then
    return 'XXX';
  end if;

  if cardinality(words) >= 3 then
    s := left(words[1], 1) || left(words[2], 1) || left(words[3], 1);
  elsif cardinality(words) = 2 then
    a := words[1];
    b := words[2];
    if length(a) <= 2 then
      s := left(a || b, 3);
    else
      s := left(a, 1) || left(b, 2);
    end if;
  else
    s := left(words[1], 3);
  end if;

  return left(s || 'XXX', 3);
end;
$$;

-- 2. El generador: las letras del titulo y cuatro digitos que nadie tenga.
create or replace function public.generate_tbt_id(p_title text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  letters text := public.tbt_id_letters(p_title);
  candidate text;
begin
  for attempt in 1 .. 200 loop
    candidate := letters || lpad((floor(random() * 10000))::int::text, 4, '0');
    if not exists (select 1 from public.works where tbt_id = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'no quedan IDs libres para %', letters;
end;
$$;

-- 3. El trigger lee el titulo y corre como propietario, para ver la tabla entera.
create or replace function public.set_tbt_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tbt_id is null then
    new.tbt_id := public.generate_tbt_id(new.title);
  end if;
  return new;
end;
$$;

drop function if exists public.generate_tbt_id();

-- Nadie las llama salvo el trigger, que corre como propietario.
revoke execute on function public.tbt_id_letters(text)  from public, anon, authenticated;
revoke execute on function public.generate_tbt_id(text) from public, anon, authenticated;
revoke execute on function public.set_tbt_id()          from public, anon, authenticated;
grant execute on function public.tbt_id_letters(text)  to service_role;
grant execute on function public.generate_tbt_id(text) to service_role;

-- 4. Las obras que ya existen.
alter table public.works add column if not exists legacy_tbt_id text;
alter table public.works drop constraint if exists valid_tbt_id;

do $$
declare
  r record;
  moved int := 0;
begin
  for r in
    select id, tbt_id, title
      from public.works
     where tbt_id !~ '^[A-Z]{3}[0-9]{4}$'
     order by created_at nulls last, id
  loop
    update public.works
       set legacy_tbt_id = coalesce(legacy_tbt_id, r.tbt_id),
           tbt_id = public.generate_tbt_id(r.title)
     where id = r.id;
    moved := moved + 1;
  end loop;
  raise notice 'obras con ID nuevo: %', moved;
end;
$$;

update public.work_amendments a
   set tbt_id = w.tbt_id
  from public.works w
 where a.work_id = w.id
   and a.tbt_id = w.legacy_tbt_id;

alter table public.works
  add constraint valid_tbt_id check (tbt_id ~ '^[A-Z]{3}[0-9]{4}$');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'valid_legacy_tbt_id') then
    alter table public.works add constraint valid_legacy_tbt_id
      check (legacy_tbt_id is null or legacy_tbt_id ~ '^TBT-[0-9]{4}-[A-Z0-9]{6}$');
  end if;
end;
$$;

create unique index if not exists works_legacy_tbt_id_key
  on public.works (legacy_tbt_id) where legacy_tbt_id is not null;

-- 5. Antes de confirmar.
do $$
declare
  examples text[] := array[
    ['Aurora, No. 4', 'AUR'],
    ['The Weeping Woman', 'TWW'],
    ['La Vie', 'LAV'],
    ['The Old Guitarist', 'TOG'],
    ['Raíces Rojas', 'RRO'],
    ['Tierra y Cielo', 'TYC'],
    ['El Umbral', 'ELU'],
    ['Water Lilies', 'WLI']
  ];
  got text;
  bad int;
begin
  for i in 1 .. array_length(examples, 1) loop
    got := public.tbt_id_letters(examples[i][1]);
    if got <> examples[i][2] then
      raise exception 'la regla no reproduce el prototipo: % dio %, se esperaba %',
        examples[i][1], got, examples[i][2];
    end if;
  end loop;

  select count(*) into bad from public.works where tbt_id !~ '^[A-Z]{3}[0-9]{4}$';
  if bad > 0 then
    raise exception 'quedan % obras sin el formato nuevo', bad;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'trigger_set_tbt_id' and tgrelid = 'public.works'::regclass
  ) then
    raise exception 'falta el trigger trigger_set_tbt_id';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.set_tbt_id()'::regprocedure) then
    raise exception 'set_tbt_id tiene que correr como propietario';
  end if;
end;
$$;

commit;
