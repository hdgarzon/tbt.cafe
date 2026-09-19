-- ============================================================================
-- 049_image_vectors_and_sha256.sql — El indice de originalidad, junto a la evidencia
-- ============================================================================
-- Update Package 01, N10 (aprobado 17 septiembre 2026: opcion C, pgvector en
-- Supabase). Federico condicion #2: la tabla es solo del service role. Federico
-- condicion #3: la sha256 se calcula en el servidor sobre los bytes guardados,
-- nunca sobre lo que declara el navegador.
--
-- Sobre el procesador: deja de guardar nada. Devuelve un vector para una
-- imagen y responde /health. tbt.cafe escribe `image_vectors`, corre la
-- consulta de similitud, aplica los umbrales 0.75 y 0.90 y es dueno del
-- reconstructor. La ventaja es doble: sin credenciales de Supabase en el
-- procesador, y el conteo del indice cabe en una consulta contra `works`.
--
-- Sobre `works.image_sha256`: es el primer filtro, y es honesto. Atrapa solo
-- copias byte-identicas — una reencodificacion del mismo archivo pasa por
-- aqui sin marca. La deteccion de similitud perceptual es lo que cubre ese
-- caso, y vive en `image_vectors`.
--
-- Nota sobre `content_hash` (migracion 029): sigue existiendo con su proposito
-- original —hacer el certificado autoverificable con el archivo de origen que
-- solo tiene el creador, calculado en el cliente antes de normalizar—. Es una
-- cosa distinta y no debe confundirse: `image_sha256` es lo que nuestro
-- almacen ve, `content_hash` es lo que el creador subio.
--
-- No destructiva: no toca filas.
-- ============================================================================

create extension if not exists vector with schema extensions;

-- works.image_sha256 — sha256 de los bytes guardados en works-media, servidor.
alter table public.works
  add column if not exists image_sha256 text;

create index if not exists works_image_sha256_idx
  on public.works (image_sha256) where image_sha256 is not null;

comment on column public.works.image_sha256 is
  'SHA-256 (hex, sin prefijo) de los bytes tal como quedaron en works-media, calculado en el servidor. Federico condicion #3. Atrapa solo copias byte-identicas — una reencodificacion no. No es content_hash: aquel es el archivo de origen que solo tiene el creador, este es lo que nuestro almacen ve.';

-- image_vectors — el embedding de cada obra, junto a la evidencia.
create table if not exists public.image_vectors (
  work_id uuid primary key references public.works(id) on delete cascade,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now()
);

comment on table public.image_vectors is
  'Embedding SigLIP de cada obra certificada. Solo el service role puede tocarla: un embedding es una representacion real de la imagen. Federico condicion #2.';

comment on column public.image_vectors.embedding is
  'SigLIP base (google/siglip-base-patch16-224), 768 dimensiones, L2-normalizadas por el procesador. Cambiar de modelo pide reconstruir la tabla — la columna no puede cambiar sin reconstruir.';

-- HNSW sobre coseno. La busqueda usa el operador `<=>` (cosine distance).
create index if not exists image_vectors_embedding_idx
  on public.image_vectors using hnsw (embedding extensions.vector_cosine_ops);

-- Service role only. Sin politicas, la RLS niega a anon y authenticated por
-- defecto. Mismo patron que plagiarism_scans, biometric_proofs, admin_step_up.
alter table public.image_vectors enable row level security;

-- Guardra runtime: si alguien anade una politica en una migracion futura sin
-- darse cuenta, el `raise` la caza. Mismo patron que la comprobacion de la 048
-- sobre roast_questions.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'image_vectors'
  ) then
    raise exception '049: image_vectors no debe tener politicas; el acceso es solo service role';
  end if;
end
$$;
