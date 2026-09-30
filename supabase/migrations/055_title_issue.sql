-- ============================================================================
-- 055_title_issue.sql — El título se emite en el servidor, congelado y re-renderizable
-- ============================================================================
-- Work Order 01 Stage 5 (Steps 15–18), a Title Specification 02.
--
-- 1. La firma del creador (Spec 02 §5). `profiles.signature_strokes` es la
--    actual; `works.signature_strokes` es la copia congelada al certificar, y
--    es la única que lee el renderer. Trazos normalizados a la caja 330 × 80,
--    no una imagen.
--
-- 2. Lo que el título imprime, congelado en la fila (`facts`). Un título se
--    re-renderiza byte a byte desde aquí (Spec 02 §4 a): pasados los 30 días
--    tbt.cafe no guarda el archivo, y una reemisión lo vuelve a producir
--    idéntico. Es también lo que el Title File firmará más adelante (número,
--    obra, línea del titular, fecha de emisión y hash de la imagen).
--
-- 3. Los archivos, en una tabla aparte y solo del service role. `titles` es
--    legible por cualquiera (política de la 045); las rutas y los hashes de los
--    archivos del titular no tienen por qué serlo.
--
-- 4. El título lo emite el servidor, nunca el navegador. La política de la
--    045 dejaba al creador o al dueño insertar filas en `titles` desde el
--    cliente: con la emisión real, eso sería poder fabricarse un título.
--
-- 5. El bucket `titles`, privado. La página del enlace entrega URLs firmadas
--    de vida corta después de autenticar al titular.
--
-- No destructiva: añade columnas y tablas, cierra una política de inserción.
-- ============================================================================

-- ─── La firma (Spec 02 §5 b, c, f) ───────────────────────────────────────────
alter table public.profiles
  add column if not exists signature_strokes jsonb;
alter table public.works
  add column if not exists signature_strokes jsonb;

-- La firma la escribe el propio creador desde el navegador (su fila, RLS de
-- la 001). Se acota el tamaño: unos cientos de trazos son una firma; megabytes
-- serían otra cosa.
alter table public.profiles drop constraint if exists profiles_signature_strokes_array;
alter table public.profiles add constraint profiles_signature_strokes_array
  check (signature_strokes is null or (jsonb_typeof(signature_strokes) = 'array' and pg_column_size(signature_strokes) < 65536));
alter table public.works drop constraint if exists works_signature_strokes_array;
alter table public.works add constraint works_signature_strokes_array
  check (signature_strokes is null or jsonb_typeof(signature_strokes) = 'array');

comment on column public.profiles.signature_strokes is
  'La firma actual del creador: arreglo de trazos, cada uno una lista de puntos [x, y] normalizados a 330 × 80. Opcional. Title Spec 02 §5.';
comment on column public.works.signature_strokes is
  'Copia congelada de la firma del creador al certificar. Nunca cambia para esta obra aunque el creador redibuje la suya; el renderer lee solo esta. Title Spec 02 §5 c, f.';

-- La 053 cerró al cliente toda columna de profiles que no esté en su lista, y
-- esta también: el creador lee la suya por my_profile_private(), que se
-- reescribe aquí para devolverla. Sigue respondiendo solo por auth.uid().
create or replace function public.my_profile_private()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'email', p.email,
    'phone', p.phone,
    'physical_address', p.physical_address,
    'tax_id', p.tax_id,
    'legal_name', p.legal_name,
    'recovery_email', p.recovery_email,
    'recovery_email_verified', p.recovery_email_verified,
    'has_private_code', p.private_code_hash is not null,
    'private_code_freq', p.private_code_freq,
    'signature_strokes', p.signature_strokes
  )
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke execute on function public.my_profile_private() from public, anon, authenticated;
grant execute on function public.my_profile_private() to authenticated;

-- ─── Lo que el título imprime ────────────────────────────────────────────────
alter table public.titles
  add column if not exists title_number text,
  add column if not exists event text,
  add column if not exists event_date date,
  add column if not exists facts jsonb,
  add column if not exists source_key text,
  add column if not exists issued_at timestamptz default now(),
  add column if not exists link_expires_at timestamptz;

alter table public.titles drop constraint if exists titles_event_check;
alter table public.titles add constraint titles_event_check
  check (event is null or event in ('REGISTERED', 'PURCHASED', 'TRANSFERRED', 'AUTHENTICATED'));

-- Una emisión por hecho: el mismo registro o la misma transferencia reintentada
-- no produce un segundo título.
create unique index if not exists titles_source_key_key
  on public.titles (source_key) where source_key is not null;
-- Y una versión por obra.
create unique index if not exists titles_work_version_key
  on public.titles (work_id, version) where title_number is not null;
create index if not exists titles_owner_number_idx
  on public.titles (owner_id, title_number);

comment on column public.titles.facts is
  'Lo que el título imprime, congelado al emitir: la entrada exacta del renderer. Re-renderizar desde aquí produce el mismo archivo byte a byte (Title Spec 02 §4 a).';
comment on column public.titles.source_key is
  'El hecho que emitió este título (registration:<work>, transfer:<transfer>). Único: un reintento no emite dos veces.';
comment on column public.titles.link_expires_at is
  'La página del enlace abre durante 30 días desde la emisión; se guarda ahora para que el aviso del día 25 no pida otra migración.';

-- ─── Los archivos, solo del servidor ─────────────────────────────────────────
create table if not exists public.title_files (
  title_id uuid primary key references public.titles(id) on delete cascade,
  gif_path text not null,
  png_path text not null,
  webp_path text not null,
  gif_sha256 text not null,
  png_sha256 text not null,
  webp_sha256 text not null,
  render_ms integer,
  rendered_at timestamptz not null default now(),
  -- Pasados los 30 días se borran los binarios; la fila queda como constancia
  -- de qué se entregó, con qué hash.
  files_deleted_at timestamptz
);

comment on table public.title_files is
  'Los archivos de cada título en el bucket privado `titles`, con sus hashes. Solo service role: sin políticas, la RLS niega a anon y authenticated.';

alter table public.title_files enable row level security;
revoke all on public.title_files from anon, authenticated;

-- ─── El título lo emite el servidor ──────────────────────────────────────────
drop policy if exists "Creador o dueño puede emitir titulos" on public.titles;

-- `titles` es legible por cualquiera (política "Titulos son publicos"). Las
-- columnas nuevas `facts` y `source_key` no pueden serlo: `facts` lleva la firma
-- del creador en trazos y la línea del titular tal como se imprimió, y la firma
-- es un dato personal (Spec 02 §5 e). La RLS filtra filas, no columnas, así que
-- se retira el SELECT de la tabla y se devuelve columna por columna, sin esas dos.
-- Solo el servidor (service role) las lee. Ningún código del cliente lee titles.
revoke select on public.titles from anon, authenticated;
grant select (id, work_id, owner_id, title_url, qr_code_data, version, generated_at, valid_until,
              supersedes, kind, delivery_state, title_number, event, event_date, issued_at, link_expires_at)
  on public.titles to anon, authenticated;
revoke insert, update, delete on public.titles from anon, authenticated;

-- ─── El bucket ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('titles', 'titles', false)
on conflict (id) do update set public = false;
