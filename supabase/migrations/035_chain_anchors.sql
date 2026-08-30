-- ============================================================================
-- 035_chain_anchors.sql — El ancla de Bitcoin de cada registro
-- ============================================================================
-- Chain Spec 01, Item 8. Aditiva.
--
-- UNA TABLA, NO COLUMNAS REPARTIDAS
--
-- El spec habla de `chain_records.ots_proof`, pero `chain_records` es el nombre
-- del ARCHIVO de su migracion 028, no una tabla que llegue a definir. Con los
-- registros repartidos entre `works` (la registracion) y `ownership_history`
-- (la procedencia), meter tres columnas en cada una obligaria al cron a
-- recorrer dos sitios y a duplicar la logica.
--
-- Se ancla un HASH. De donde salio ese hash da igual para anclarlo, asi que la
-- clave es el hash y la tabla es una.
--
-- LA PRUEBA VA ENTERA, NO SU RUTA
--
-- El spec insiste: «Store the bytes, not a path. The anchor is worthless
-- without the proof». Son unos kilobytes —la sonda dio 875 bytes— y sin ellos
-- el ancla no se puede verificar ni servir a un tercero.
--
-- PENDIENTE ES UN ESTADO NORMAL
--
-- La confirmacion tarda horas porque los calendarios agregan muchos hashes en
-- un arbol de Merkle y solo comprometen la raiz en Bitcoin. Por eso hay un
-- indice parcial sobre lo pendiente: es lo unico que el cron consulta.
-- ============================================================================

create table if not exists public.chain_anchors (
  -- El sha256 del registro canonico, en hex y sin prefijo.
  record_hash text primary key,

  -- De donde vino, solo para poder mirarlo desde el otro lado.
  record_kind text not null check (record_kind in ('registration', 'provenance', 'amendment')),
  record_uri text,

  -- La prueba .ots completa. Incompleta al sellar, se reemplaza al actualizar.
  ots_proof bytea not null,

  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  block_height integer,
  attested_at timestamp with time zone,

  -- Cuantas veces lo intento el cron, para poder ver uno atascado.
  upgrade_attempts integer not null default 0,
  last_attempt_at timestamp with time zone,

  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Lo unico que el cron consulta.
create index if not exists chain_anchors_pending_idx
  on public.chain_anchors (created_at) where status = 'pending';

comment on table public.chain_anchors is
  'Anclas de OpenTimestamps. La prueba se guarda entera: sin ella el ancla no vale nada.';
comment on column public.chain_anchors.status is
  'pending no es un fallo — la confirmacion en Bitcoin tarda horas por diseño.';

alter table public.chain_anchors enable row level security;

-- Sin politicas: solo el service role escribe y lee. La pagina de la obra
-- sirve la prueba a traves de una ruta, no dando acceso directo a la tabla.
