-- ============================================================================
-- 052_plagiarism_scans_writer.sql — El escaneo se guarda antes de que exista la obra
-- ============================================================================
-- Update Package 01, N9 (a) y §6 "Scan stored": un brew completado deja una
-- fila en plagiarism_scans y la pagina de la obra dice "Scanned" con su fecha.
--
-- La tabla viene del esquema base con `work_id not null`, pero el escaneo
-- corre en la fase Proteccion, antes de crear el borrador: no hay obra que
-- nombrar. La ruta de similitud escribia columnas que no existen (`user_id`,
-- `status`, `top_score`, `matches`); supabase-js devuelve el error en vez de
-- lanzarlo, el `try/catch` no lo veia, y la tabla quedo vacia.
--
-- Ahora:
--   - el escaneo se guarda con quien lo pidio y sin obra;
--   - el borrador guarda el id del escaneo en `works.plagiarism_scan_id`;
--   - complete-tbt, al certificar, pone `work_id` en el escaneo — solo si es
--     del mismo creador y no estaba ya enlazado a otra obra.
--
-- Las columnas existentes se reutilizan: `scan_result` lleva el veredicto y
-- las coincidencias, `similarity_score` el puntaje mas alto en porcentaje,
-- `is_original` si salio limpio. No se abren politicas: la tabla sigue siendo
-- solo del service role; la pagina de la obra lee la fecha en el servidor.
--
-- No destructiva: no toca filas.
-- ============================================================================

alter table public.plagiarism_scans
  alter column work_id drop not null;

alter table public.plagiarism_scans
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_plagiarism_scans_user_id
  on public.plagiarism_scans (user_id) where work_id is null;

comment on table public.plagiarism_scans is
  'Un escaneo de originalidad por fila. Lo escribe /api/tbt-image/similarity sin obra; complete-tbt pone work_id al certificar. Solo service role.';
comment on column public.plagiarism_scans.user_id is
  'Quien pidio el escaneo. complete-tbt solo enlaza un escaneo cuyo user_id es el creador de la obra.';
comment on column public.plagiarism_scans.similarity_score is
  'Coincidencia mas alta contra image_vectors, en porcentaje (0-100).';
comment on column public.plagiarism_scans.scan_result is
  '{ status: clear | warning | blocked, matches: [{ work_id, score }] }';

-- works.plagiarism_scan_id — el escaneo que precedio a este borrador.
alter table public.works
  add column if not exists plagiarism_scan_id uuid references public.plagiarism_scans(id) on delete set null;

comment on column public.works.plagiarism_scan_id is
  'El escaneo de la fase Proteccion. Lo escribe el borrador; complete-tbt lo verifica contra el creador antes de enlazarlo. No es prueba por si solo: la fila enlazada lo es.';
