-- ============================================================================
-- 051_drop_works_owner_index.sql — La cuenta de tenencias vive en un solo sitio
-- ============================================================================
-- Update Package 01, §2, Step 8 (correccion).
--
-- La migracion 045 añadio `works.owner_index` para contar tenencias — cada
-- cambio de dueño era +1, jamas se reasignaba. Ese numero YA existia en
-- `ownership_history.sequence_number`, calculado por el mismo trigger que
-- lleva ese historial y con las mismas garantias. Dos copias del mismo
-- numero, con dos maneras de mantenerlas, es la forma en la que un dia
-- divergen. Se lee del historial y basta.
--
-- Nada bajo src/ lee `works.owner_index`. Dropearlo no rompe codigo hoy. Si
-- alguna vista o RPC dependiera de el, esa vista fallaria en el `drop`, que
-- es exactamente lo que queremos: nombra la dependencia antes de que se
-- pierda en silencio.
--
-- No destructiva sobre las filas de otras tablas. Si sensible sobre works:
-- pierde una columna. `ownership_history.sequence_number` cubre el mismo
-- proposito y no se toca.
-- ============================================================================

alter table public.works drop constraint if exists works_owner_index_check;
alter table public.works drop column if exists owner_index;
