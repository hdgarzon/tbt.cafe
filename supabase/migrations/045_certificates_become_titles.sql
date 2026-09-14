-- ============================================================================
-- 045_certificates_become_titles.sql — El certificado pasa a ser un titulo
-- ============================================================================
-- Work Order 01, Stage 3 (Steps 7 y 8). Title Specification 01, §1, §7 y §11.
--
-- NO ES UN RENOMBRE DE ESTETICA
--
-- El certificado era una credencial al portador con un codigo secreto, y nunca
-- llego a construirse: no hay generador, complete-transfer no entregaba nada y el
-- codigo se generaba, se hasheaba y se tiraba. Lo sustituye un titulo, como el de
-- un vehiculo: acredita la propiedad en vez de concederla, no lleva nada secreto,
-- se emite uno nuevo cada vez que el registro cambia y su dueño puede enseñarlo.
--
-- LA TABLA SE RENOMBRA Y DEJA UNA VISTA DETRAS
--
-- La tabla tiene 57 filas y la escriben complete-tbt y complete-transfer. Entre
-- aplicar este SQL y desplegar el codigo que ya dice titles pasan unos minutos,
-- y en ellos una registracion o un traspaso fallarian al insertar. Por eso queda
-- una vista con el nombre viejo sobre titles: simple, actualizable y con
-- security_invoker, asi que la RLS de titles se aplica a quien llama. Se crea
-- ANTES de las columnas nuevas y con lista explicita, para que no las incluya: un
-- insert a traves de ella toma los valores por defecto de la tabla. La siguiente
-- migracion la quita, cuando el codigo ya no la nombre.
--
-- ORDEN: aplicar este SQL primero y desplegar despues. Lo que desaparece aqui es
-- un nombre, no aparece una columna.
--
-- Restricciones, indices y politicas cambian de nombre con la tabla. Las
-- politicas se recrean con el mismo efecto; la de insercion evalua auth.uid() una
-- vez por consulta en lugar de una por fila.
--
-- La columna de URL pasa a title_url. No se ha escrito nunca (0 de 57 filas),
-- igual que valid_until; se conservan hasta que se decida que guarda la pagina
-- del enlace.
--
-- LO QUE EL TITULO NECESITA (Step 8)
--
--   titles.supersedes      el titulo al que este sustituye. El anterior pasa a
--                          documento historico, no a nulo.
--   titles.kind            standard | bonded.
--   titles.delivery_state  pending | sent | failed. Pendiente es un estado, no un
--                          error. Las 57 filas quedan pending: ninguna se entrego.
--   works.owner_index      cuenta tenencias, no personas. Forma parte del numero
--                          del titulo, asi que nunca se reasigna. Se rellena con 1
--                          mas los cambios de dueño del historial.
--   works.creator_status   living | deceased | unknown. Las obras de hoy las
--                          registro su creador: living. El flujo del coleccionista
--                          tendra que decirlo siempre, no heredar el valor.
--   works.provenance_hash  hash del documento de propiedad, con el formato de
--                          content_hash. El documento se guarda en privado, nunca
--                          en cadena.
--
-- titles.version ya existe y vale 1 en las 57 filas, porque los dos sitios que
-- insertan lo fijan a mano. Incrementarlo y enlazar supersedes es el Step 14.
--
-- No destructiva. Se comprueba a si misma y se puede aplicar dos veces.
-- ============================================================================

begin;

-- 1. La tabla, sus restricciones, sus indices y la columna de URL.
do $$
declare
  r record;
begin
  if to_regclass('public.titles') is null then
    alter table public.certificates rename to titles;
  end if;

  -- Todas las que llevan el nombre de la tabla: la clave primaria, las dos
  -- foraneas y, desde Postgres 18, tambien los NOT NULL, que pasan a ser
  -- restricciones con nombre propio y no cambian solas con la tabla.
  for r in
    select conname from pg_constraint
     where conrelid = 'public.titles'::regclass
       and conname like 'certificates\_%'
  loop
    execute format('alter table public.titles rename constraint %I to %I',
                   r.conname, 'titles_' || substr(r.conname, length('certificates_') + 1));
  end loop;

  if to_regclass('public.idx_certificates_work_id') is not null then
    alter index public.idx_certificates_work_id rename to idx_titles_work_id;
  end if;
  if to_regclass('public.idx_certificates_owner_id') is not null then
    alter index public.idx_certificates_owner_id rename to idx_titles_owner_id;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'titles'
                and column_name = 'certificate_url') then
    alter table public.titles rename column certificate_url to title_url;
  end if;
end;
$$;

-- 2. Las politicas, con el mismo efecto.
drop policy if exists "Certificados son públicos" on public.titles;
drop policy if exists "Sistema puede crear certificados" on public.titles;
drop policy if exists "Titulos son publicos" on public.titles;
drop policy if exists "Creador o dueño puede emitir titulos" on public.titles;

create policy "Titulos son publicos" on public.titles
  for select using (true);

create policy "Creador o dueño puede emitir titulos" on public.titles
  for insert with check (
    exists (
      select 1 from public.works w
       where w.id = titles.work_id
         and (w.creator_id = (select auth.uid()) or w.current_owner_id = (select auth.uid()))
    )
  );

-- 3. El nombre viejo, como vista, para el codigo que todavia lo usa. Antes de
--    las columnas nuevas.
do $$
begin
  if to_regclass('public.certificates') is null then
    create view public.certificates with (security_invoker = on) as
      select id, work_id, owner_id, title_url, qr_code_data, version, generated_at, valid_until
        from public.titles;
  end if;
end;
$$;

-- 4. Lo que el titulo necesita.
alter table public.titles
  add column if not exists supersedes uuid,
  add column if not exists kind text not null default 'standard',
  add column if not exists delivery_state text not null default 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'titles_supersedes_fkey') then
    alter table public.titles add constraint titles_supersedes_fkey
      foreign key (supersedes) references public.titles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'titles_not_self_superseding') then
    alter table public.titles add constraint titles_not_self_superseding
      check (supersedes is null or supersedes <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'titles_kind_check') then
    alter table public.titles add constraint titles_kind_check
      check (kind in ('standard', 'bonded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'titles_delivery_state_check') then
    alter table public.titles add constraint titles_delivery_state_check
      check (delivery_state in ('pending', 'sent', 'failed'));
  end if;
end;
$$;

create index if not exists idx_titles_supersedes
  on public.titles (supersedes) where supersedes is not null;

alter table public.works
  add column if not exists owner_index integer not null default 1,
  add column if not exists creator_status text not null default 'living',
  add column if not exists provenance_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_owner_index_check') then
    alter table public.works add constraint works_owner_index_check
      check (owner_index >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'works_creator_status_check') then
    alter table public.works add constraint works_creator_status_check
      check (creator_status in ('living', 'deceased', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'works_provenance_hash_check') then
    alter table public.works add constraint works_provenance_hash_check
      check (provenance_hash is null or provenance_hash ~ '^sha256:[0-9a-f]{64}$');
  end if;
end;
$$;

-- Cada cambio de dueño del historial es una tenencia mas. Solo toca las obras
-- que siguen en el valor inicial: un indice ya avanzado no se recalcula nunca.
update public.works w
   set owner_index = 1 + h.changes
  from (
    select work_id, count(*) filter (where event_type <> 'creation') as changes
      from public.ownership_history
     group by work_id
  ) h
 where h.work_id = w.id
   and w.owner_index = 1
   and h.changes > 0;

comment on table public.titles is
  'Un titulo por cada emision. Acredita la propiedad, no la concede, y no lleva nada secreto. Antes certificates.';
comment on column public.titles.supersedes is
  'El titulo al que este sustituye. El anterior pasa a documento historico.';
comment on column public.titles.kind is
  'standard | bonded. Bonded cuando lo registra un coleccionista.';
comment on column public.titles.delivery_state is
  'pending | sent | failed. Pendiente es un estado, no un error.';
comment on column public.works.owner_index is
  'Cuenta tenencias, no personas. Forma parte del numero del titulo: nunca se reasigna.';
comment on column public.works.creator_status is
  'living | deceased | unknown. Decide el formulario bonded y la ruta de autenticacion.';
comment on column public.works.provenance_hash is
  'Hash del documento de propiedad (sha256:hex). El documento se guarda en privado, nunca en cadena.';

-- 5. Antes de confirmar.
do $$
begin
  if to_regclass('public.titles') is null then
    raise exception 'falta la tabla titles';
  end if;
  if (select relkind from pg_class where oid = 'public.certificates'::regclass) <> 'v' then
    raise exception 'el nombre viejo tiene que quedar como vista, no como tabla';
  end if;
  if not exists (
    select 1 from pg_class c, unnest(c.reloptions) o
     where c.oid = 'public.certificates'::regclass
       and o in ('security_invoker=on', 'security_invoker=true')
  ) then
    raise exception 'la vista tiene que aplicar la RLS de quien llama';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.titles'::regclass) then
    raise exception 'titles perdio la RLS';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'titles') <> 2 then
    raise exception 'titles tiene que tener exactamente sus dos politicas';
  end if;
end;
$$;

commit;
