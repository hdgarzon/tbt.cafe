-- ============================================================================
-- 034_chain_record_uris.sql — Donde vive lo que se publica en Arweave
-- ============================================================================
-- Chain Spec 01, Item 6. Aditiva: solo anade columnas nulables.
--
-- DOS SITIOS, PORQUE SON DOS COSAS
--
-- El registro de REGISTRACION es uno por obra y no cambia nunca: la secuencia 1
-- del Item 4, con el hash del contenido, el creador y la obra. Va en `works`.
--
-- La PROCEDENCIA es una cadena: una entrada al certificar y otra por cada
-- transferencia. `ownership_history` ya la modela —una fila por evento, con
-- `sequence_number` y `event_type`— asi que el registro publicado va junto a la
-- fila que representa, no en una columna suelta de `works` que solo podria
-- guardar el ultimo.
--
-- POR QUE SE GUARDA LA URI ANTES DEL MINT
--
-- El Item 6 avisa: si el mint falla despues de la subida, el registro existe sin
-- referencia — recuperable. Lo que NO se puede hacer es volver a subir, porque
-- dos registros de registracion para un TBT sin enlace `supersedes` entre ellos
-- es la unica forma que este modelo no sabe expresar.
--
-- Guardar la URI antes de mintear es lo que hace posible reintentar el MINT
-- contra ella en vez de republicar. Sin esta columna, un reintento no tendria a
-- que agarrarse.
--
-- El hash se guarda al lado para poder verificar sin descargar: es el mismo que
-- va en la etiqueta `TBT-Record-Hash` de la subida.
-- ============================================================================

alter table public.works
  add column if not exists registration_record_uri text,
  add column if not exists registration_record_hash text;

comment on column public.works.registration_record_uri is
  'Arweave. Se escribe ANTES del mint para que un reintento del mint la reutilice en vez de republicar.';

alter table public.ownership_history
  add column if not exists record_uri text,
  add column if not exists record_hash text;

comment on column public.ownership_history.record_hash is
  'Hash del registro de procedencia de esta fila. El siguiente eslabon lo lleva dentro como prior_record.';

create index if not exists works_registration_record_idx
  on public.works (registration_record_uri) where registration_record_uri is not null;
