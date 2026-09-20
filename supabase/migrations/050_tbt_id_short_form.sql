-- ============================================================================
-- 050_tbt_id_short_form.sql — TBT ID: tres letras y cuatro digitos
-- ============================================================================
-- Update Package 01, §3 (decision 76, tal como la regla de letras la corrigio).
-- Work Order 01, Stage 2 (Steps 3 y 4).
--
-- EL FORMATO CORTO
--
-- El ID de una obra son tres letras sacadas del titulo y cuatro digitos: RRO5501.
-- Produccion emite el formato largo (TBT-YYYY-XXXXXX), añadido por error y fijado
-- despues con un constraint. La diferencia no es estetica: la direccion corta
-- cabe en un QR de 29 modulos con correccion H; la larga necesita 37 y deja de
-- escanear al tamaño impreso del titulo. Este cambio lo arregla, y a la vez
-- lleva la asignacion al momento en el que el ID de verdad importa.
--
-- LA REGLA DE LAS LETRAS
--
--   tres palabras o mas         las iniciales           The Weeping Woman → TWW
--   dos, la primera de 1 o 2    esas + la inicial       El Umbral         → ELU
--   dos, la primera mas larga   inicial + dos letras    Raices Rojas      → RRO
--   una palabra                 sus tres primeras       Aurora            → AUR
--
-- Lo que va tras la primera coma no cuenta (Aurora, No. 4 → AUR). Las tildes se
-- quitan y solo cuentan letras latinas. Si el titulo no da tres letras utiles,
-- se cae al plan B.
--
-- EL PLAN B (Federico condicion (a) del §3): si un titulo no da tres letras
-- —muy corto, "Untitled", alfabeto no latino— se prueba con el nombre del
-- creador por la misma regla (Sara Alarcon → SAL). Si aun asi no sale, se usa
-- TBT. Un titulo hecho solo de digitos ya no se convierte en XXX.
--
-- LA LISTA DE BLOQUEO (Federico condicion (b) del §3): las tres letras se
-- comprueban contra una lista que vive en platform_config.tbt_id_blocklist. Si
-- caen ahi, se pasa al plan B. Se aplica solo al emitir; los IDs ya emitidos no
-- se tocan. Un operador amplia la lista despues, en la herramienta de
-- administracion, sin migracion nueva.
--
-- ASIGNACION EN LA CERTIFICACION (Federico condicion (c) del §3): el trigger
-- que emitia el ID corria BEFORE INSERT sobre el borrador. Un borrador que
-- nunca se pago consumia un ID, y bastaba con abrir Brew para gastar uno. Ahora
-- el ID se asigna BEFORE UPDATE cuando status pasa a 'certified' — despues del
-- Sello y del pago. Como works.tbt_id es NOT NULL, un borrador entra con el
-- uuid de la propia obra como marcador; el constraint lo acepta, la unicidad
-- se mantiene, y solo la certificacion lo cambia por el formato corto.
--
-- SIN CONVERSION (Federico condicion (d) del §3): no se añade legacy_tbt_id,
-- no se actualizan obras existentes, no se toca work_amendments, no hay
-- constraint doble. El paquete registra que las obras en produccion son datos
-- de prueba que se borran antes del lanzamiento — la migracion se niega a
-- correr mientras siga habiendo alguna con el formato antiguo.
--
-- POR QUE EL TRIGGER CORRE COMO PROPIETARIO
--
-- El insert lo hace el navegador con el rol authenticated, y la comprobacion
-- de que un ID esta libre corria con ese rol: con la RLS de works solo ve las
-- obras certificadas y las suyas. Con diez mil numeros por combinacion de
-- letras, un ID ocupado por el borrador de otra persona pasaria por libre y el
-- insert moriria en el unique. `generate_tbt_id` y
-- `set_tbt_id_on_certification` son security definer para ver la tabla entera.
-- Como funciones de trigger no se pueden invocar por RPC, y en el caso de
-- generate_tbt_id el REVOKE deja tres roles fuera. check:grants las revisa una
-- a una.
--
-- Todo en una transaccion. Se comprueba a si misma antes de confirmar.
-- ============================================================================

begin;

-- 1. Preflight. La migracion no corre mientras haya obras con formato heredado
-- — Update Package 01, §5: los datos de prueba se borran antes del lanzamiento.
do $$
declare
  n int;
begin
  select count(*) into n
    from public.works
   where tbt_id !~ '^[A-Z]{3}[0-9]{4}$'
     and tbt_id <> id::text;
  if n > 0 then
    raise exception
      '050: no se puede aplicar — % obras aun llevan tbt_id en formato heredado. Bo'
      'rralas (todas son datos de prueba, Update Package 01 §5) antes de correr est'
      'a migracion.',
      n;
  end if;
end;
$$;

-- 2. La lista de bloqueo vive en platform_config. Semillas de companion §4.
alter table public.platform_config
  add column if not exists tbt_id_blocklist text[] not null default '{}';

update public.platform_config
   set tbt_id_blocklist = array[
     -- Ingles (sexual o vulgar)
     'ASS','CUM','FUC','FUK','FCK','SEX','TIT','DIK','COK','CNT','JIZ','XXX','WTF',
     -- Español
     'ANO','CUL','PTA','PUT','PTO','MRD','PNE','VRG','PJA','ZRR','CBR','CTM','PTM','CSM','HDP',
     -- Portugues
     'FDP','PQP','BCT','CRL','PRR','VSF','TNC','KCT','BUC',
     -- Frances
     'NIQ','TGL','ENC',
     -- Odio o insultos
     'NIG','NGR','FAG','MRC','PDE',
     -- Violento o extremista
     'KKK','NAZ','KYS'
   ]
 where id = true
   and coalesce(cardinality(tbt_id_blocklist), 0) = 0;

-- 3. "Untitled" en los cuatro idiomas, mas cadena vacia y null.
create or replace function public.is_untitled_title(p_title text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select trim(coalesce(p_title, '')) = ''
    or lower(trim(coalesce(p_title, ''))) = any (array[
      'untitled',
      'sin titulo',
      'sin título',
      'sem titulo',
      'sem título',
      'sans titre'
    ])
$$;

-- 4. La regla de las letras. Devuelve null si no salen tres — el plan B lo
-- maneja en generate_tbt_id.
create or replace function public.tbt_id_letters(p_source text)
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
           upper(translate(split_part(coalesce(p_source, ''), ',', 1),
             'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳ',
             'AAAAAACEEEEIIIINOOOOOUUUUYAAAAAACEEEEIIIINOOOOOUUUUYYAAAAAACCCCCCCCDDEEEEEEEEEEGGGGGGGGHHIIIIIIIIIJJKKLLLLLLNNNNNNOOOOOORRRRRRSSSSSSSSTTTTUUUUUUUUUUUUWWYYYZZZZZZOOUUAAIIOOUUUUUUUUUUAAAAGGKKOOOOJGGNNAAAAAAEEEEIIIIOOOORRRRUUUUSSTTHHAAEEOOOOOOOOYY')),
           '([A-Z]+)', 'g'
         ) with ordinality as t(m, ord);

  if words is null or cardinality(words) = 0 then
    return null;
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

  if length(s) < 3 then
    return null;
  end if;
  return s;
end;
$$;

-- 5. Generador. Tres letras (plan B si hace falta) mas cuatro digitos unicos
-- entre las obras. Corre como propietario para ver toda la tabla y la lista
-- de bloqueo.
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

  select tbt_id_blocklist into v_blocklist
    from public.platform_config
   where id = true;
  v_blocklist := coalesce(v_blocklist, '{}');

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
    if not exists (select 1 from public.works where tbt_id = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'no quedan IDs libres para %', v_letters;
end;
$$;

-- 6. Se retira el trigger heredado (esquema base) que emitia el formato largo.
drop trigger if exists trigger_set_tbt_id on public.works;
drop function if exists public.set_tbt_id();
drop function if exists public.generate_tbt_id();

-- 7. Marcador para el borrador — Federico condicion (c). En insert, si tbt_id
-- viene vacio, se pone el uuid de la propia obra como cadena. Cumple con el
-- NOT NULL y con el constraint, sin consumir un ID corto que ese borrador
-- puede que nunca pague.
create or replace function public.set_tbt_id_placeholder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tbt_id is null or new.tbt_id = '' then
    new.tbt_id := new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists set_tbt_id_placeholder on public.works;
create trigger set_tbt_id_placeholder
  before insert on public.works
  for each row execute function public.set_tbt_id_placeholder();

-- 8. Emision en la certificacion. Solo en la transicion a 'certified', y solo
-- si aun no lleva el formato corto (idempotente frente a un update posterior).
create or replace function public.set_tbt_id_on_certification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'certified'
     and (old.status is distinct from 'certified')
     and (new.tbt_id is null or new.tbt_id !~ '^[A-Z]{3}[0-9]{4}$') then
    new.tbt_id := public.generate_tbt_id(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists set_tbt_id_on_certification on public.works;
create trigger set_tbt_id_on_certification
  before update on public.works
  for each row execute function public.set_tbt_id_on_certification();

-- 9. Nadie las llama salvo los triggers, que corren como propietario.
revoke execute on function public.is_untitled_title(text)         from public, anon, authenticated;
revoke execute on function public.tbt_id_letters(text)            from public, anon, authenticated;
revoke execute on function public.generate_tbt_id(uuid)           from public, anon, authenticated;
revoke execute on function public.set_tbt_id_placeholder()        from public, anon, authenticated;
revoke execute on function public.set_tbt_id_on_certification()   from public, anon, authenticated;

-- 10. El constraint pasa al formato corto o al marcador de borrador. El
-- preflight de arriba garantiza que ninguna fila viola el nuevo shape.
alter table public.works drop constraint if exists valid_tbt_id;
alter table public.works
  add constraint valid_tbt_id
  check (tbt_id ~ '^[A-Z]{3}[0-9]{4}$' or tbt_id = id::text);

-- 11. Antes de confirmar.
do $$
declare
  prototypes text[][] := array[
    ['Aurora, No. 4',       'AUR'],
    ['The Weeping Woman',   'TWW'],
    ['La Vie',              'LAV'],
    ['The Old Guitarist',   'TOG'],
    ['Raíces Rojas',        'RRO'],
    ['Tierra y Cielo',      'TYC'],
    ['El Umbral',           'ELU'],
    ['Water Lilies',        'WLI']
  ];
  got text;
begin
  -- Los ocho ejemplos del prototipo, letra a letra.
  for i in 1 .. array_length(prototypes, 1) loop
    got := public.tbt_id_letters(prototypes[i][1]);
    if got is null or got <> prototypes[i][2] then
      raise exception 'la regla no reproduce el prototipo: % dio %, se esperaba %',
        prototypes[i][1], got, prototypes[i][2];
    end if;
  end loop;

  -- Untitled en los cuatro idiomas, mas los bordes.
  if not public.is_untitled_title('Untitled')
     or not public.is_untitled_title('sin título')
     or not public.is_untitled_title('SEM TÍTULO')
     or not public.is_untitled_title('Sans titre')
     or not public.is_untitled_title('  ')
     or not public.is_untitled_title(null) then
    raise exception 'is_untitled_title no cubre los cuatro idiomas + vacio + null';
  end if;
  if public.is_untitled_title('Raíces Rojas') then
    raise exception 'is_untitled_title marco un titulo real como untitled';
  end if;

  -- La lista de bloqueo esta sembrada.
  if not exists (
    select 1 from public.platform_config
    where id = true and 'ASS' = any(tbt_id_blocklist)
  ) then
    raise exception 'la lista de bloqueo no quedo sembrada';
  end if;

  -- Los dos triggers estan.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'set_tbt_id_placeholder' and tgrelid = 'public.works'::regclass
  ) then
    raise exception 'falta el trigger set_tbt_id_placeholder';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'set_tbt_id_on_certification' and tgrelid = 'public.works'::regclass
  ) then
    raise exception 'falta el trigger set_tbt_id_on_certification';
  end if;

  -- Security definer donde importa.
  if not (select prosecdef from pg_proc where oid = 'public.generate_tbt_id(uuid)'::regprocedure) then
    raise exception 'generate_tbt_id tiene que correr como propietario';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.set_tbt_id_on_certification()'::regprocedure) then
    raise exception 'set_tbt_id_on_certification tiene que correr como propietario';
  end if;
end;
$$;

commit;
