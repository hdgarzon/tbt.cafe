-- ============================================================================
-- 028_transfer_code_hash.sql — Dejar de guardar en claro la clave de traspaso
-- ============================================================================
-- Chain Implementation Spec 01, Item 1 / Cambio A.
--
-- El codigo de transferencia es la clave privada que autoriza un traspaso. La
-- regla de la plataforma es que solo viaja por MMS y no se pinta en pantalla,
-- porque una captura basta para perderla.
--
-- Hasta ahora se escribia ademas en los atributos del NFT —subidos por Irys y
-- acunados en cadena— y en esta columna, en claro. La publicacion ya se corto
-- en el codigo; esta migracion se ocupa de la copia en la base, para que la
-- base no sea la segunda forma de perderlo.
--
-- LO QUE ENCONTRAMOS AL MIRAR
--
-- Nada lee esta columna para verificar nada. Sus unicos usos eran dos
-- escrituras y la lectura que lo publicaba. No hay ruta de verificacion en el
-- codigo ni en el prototipo: el codigo se generaba, se guardaba, se publicaba y
-- no se comprobaba jamas. Por eso hashearlo no rompe ningun flujo — y por eso
-- conviene hacerlo ahora, antes de que exista el que si lo compruebe.
--
-- EL BORRADO DE LA COLUMNA VA DESPUES, A PROPOSITO
--
-- El spec dice "after backfill and verification". Queda escrito abajo y
-- comentado: soltar la columna en la misma pasada que la rellena no deja forma
-- de comprobar que el relleno salio bien.
--
-- No destructiva.
-- ============================================================================

alter table public.works
  add column if not exists transfer_code_hash text;

-- Relleno desde el texto en claro. sha256 sobre bytea, en hex, que es lo mismo
-- que produce createHash('sha256').digest('hex') en el servidor.
update public.works
   set transfer_code_hash = encode(sha256(transfer_code::bytea), 'hex')
 where transfer_code is not null
   and transfer_code_hash is null;

create index if not exists works_transfer_code_hash_idx
  on public.works (transfer_code_hash) where transfer_code_hash is not null;

comment on column public.works.transfer_code_hash is
  'SHA-256 hex del codigo de transferencia. El codigo en si solo existe en el MMS que recibio la persona: no se guarda, no se muestra y no se publica.';

comment on column public.works.transfer_code is
  'DEPRECADO — texto en claro de una credencial. Ya no se publica en cadena (Spec 01 Item 1). Drop diferido hasta verificar el relleno de transfer_code_hash.';

-- Tras verificar el relleno:
-- alter table public.works drop column transfer_code;
