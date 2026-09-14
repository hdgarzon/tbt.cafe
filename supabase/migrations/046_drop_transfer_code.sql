-- ============================================================================
-- 046_drop_transfer_code.sql — El codigo de traspaso se va entero
-- ============================================================================
-- Work Order 01, Step 9.
--
-- La 028 dejo de guardar en claro el codigo de traspaso y se quedo con su hash.
-- Lo que no se vio entonces es que el codigo tampoco llegaba a nadie:
-- complete-tbt y complete-transfer lo generan, lo hashean y lo tiran. No se le
-- pasa al MMS ni al correo, no se pinta, y nada compara nunca un hash con nada.
-- Escrito dos veces, entregado ninguna, leido ninguna.
--
-- Una columna con forma de credencial que no protege nada es peor que no
-- tenerla: invita a construir encima una verificacion contra hashes de codigos
-- que ningun dueño tiene. Quien es dueño lo dice el titulo, y el titulo no lleva
-- secreto al portador.
--
-- La 028 no se borra: corrio en produccion y las migraciones solo se añaden.
-- Esta la deshace.
--
-- DE PASO, LA VISTA DE TRANSICION DE LA 045
--
-- `certificates` quedo como vista para el codigo que aun no se habia desplegado.
-- El despliegue que lee y escribe `titles` ya esta en produccion, asi que la
-- vista no tiene a quien servir.
--
-- Destructiva a proposito: borra los hashes guardados (43 de 62 obras al
-- escribir esto). No hay forma de usarlos, porque el codigo del que salen no
-- existe en ningun sitio.
-- ============================================================================

begin;

-- Antes de soltar la columna: si alguna funcion la nombra, la columna no estaba
-- muerta. Un `drop column` no avisa de eso — la funcion solo falla al llamarla.
do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ilike '%transfer_code_hash%'
  ) then
    raise exception 'una funcion de public todavia nombra transfer_code_hash';
  end if;
end $$;

drop index if exists public.works_transfer_code_hash_idx;
alter table public.works drop column if exists transfer_code_hash;

-- Sin cascade: si algo depende de la vista, que falle aqui y no en silencio.
drop view if exists public.certificates;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'works' and column_name = 'transfer_code_hash'
  ) then
    raise exception 'works.transfer_code_hash sigue existiendo';
  end if;
  if to_regclass('public.works_transfer_code_hash_idx') is not null then
    raise exception 'works_transfer_code_hash_idx sigue existiendo';
  end if;
  if to_regclass('public.certificates') is not null then
    raise exception 'public.certificates sigue existiendo';
  end if;
  if to_regclass('public.titles') is null then
    raise exception 'public.titles no existe: la 045 no se aplico';
  end if;
end $$;

commit;
