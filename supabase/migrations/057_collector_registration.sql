-- ============================================================================
-- 057_collector_registration.sql — Registrar una obra que uno no hizo
-- ============================================================================
-- Work Order 01 Step 20, con Update Package 01 §2 y el 11+ Addendum.
--
-- 1. El reclamo es un ticket HR-#### en una categoría nueva, `claim` — no
--    CLM-####, y no claims@tbt.cafe: el dominio no tiene MX.
--
-- 2. `works.registered_as`: quien registra es el creador, o un coleccionista
--    que tiene la obra. Lo segundo emite un título bonded.
--
-- 3. Lo que el coleccionista declara del creador, en dos tablas:
--      bonded_creators — lo que puede verse: nombre (o sin atribuir), alias,
--        categoría, ciudad y país, credenciales, web, Instagram, "about", y el
--        nombre y representante de la sucesión. Se lee solo de obras
--        certificadas. De un creador vivo, ciudad y país: nunca una dirección.
--      bonded_private — lo que nunca se publica: el contacto del creador o de
--        la sucesión, el tipo de documento, de quién y cuándo se obtuvo, lo que
--        se pagó, la ruta del documento y el relato. Solo el servidor. El
--        documento vive en un bucket privado; a la cadena solo va su hash
--        (works.provenance_hash, de la 045).
--
-- 4. La lista de supresión (11+ Addendum): el bloque de la sucesión captura el
--    contacto de un tercero que nunca consintió y todavía no puede negarse, así
--    que la manera de negarse existe desde que existe el campo. Se guarda el
--    hash del contacto normalizado, no el contacto.
--
-- Todo lo escribe el servidor. Numerada después de 055 (#126) y 056 (#131).
-- No destructiva.
-- ============================================================================

-- ─── 1. La categoría del reclamo ─────────────────────────────────────────────
alter table public.tickets drop constraint if exists tickets_category_check;
alter table public.tickets add constraint tickets_category_check
  check (category in ('payments', 'payouts', 'transfers', 'registration', 'authentication', 'other', 'claim'));

-- ─── 2. Quién registra ───────────────────────────────────────────────────────
alter table public.works
  add column if not exists registered_as text not null default 'creator';
alter table public.works drop constraint if exists works_registered_as_check;
alter table public.works add constraint works_registered_as_check
  check (registered_as in ('creator', 'collector'));
comment on column public.works.registered_as is
  'creator: lo registra quien lo hizo. collector: lo registra quien lo tiene; emite un título bonded, y el creador es el de bonded_creators, no creator_id (que es quien registra).';

-- ─── 3a. Lo público del creador declarado ────────────────────────────────────
create table if not exists public.bonded_creators (
  work_id uuid primary key references public.works(id) on delete cascade,
  status text not null check (status in ('living', 'deceased', 'unknown')),
  category text not null default 'individual' check (category in ('individual', 'group', 'corporation')),
  name text,
  unattributed boolean not null default false,
  alias text,
  city text,
  credentials text,
  website text,
  instagram text,
  about text,
  estate_name text,
  estate_rep text,
  created_at timestamptz not null default now(),
  -- Sin atribuir solo cuando no se sabe quién es, y entonces sin nombre.
  constraint bonded_creators_unattributed check (not unattributed or (status = 'unknown' and name is null)),
  constraint bonded_creators_named check (unattributed or name is not null)
);

comment on table public.bonded_creators is
  'Lo que el coleccionista declara del creador de una obra bonded y puede verse. Es su palabra, no un hecho verificado. Lo privado está en bonded_private.';

alter table public.bonded_creators enable row level security;
revoke insert, update, delete on public.bonded_creators from anon, authenticated;
drop policy if exists "bonded creators of certified works" on public.bonded_creators;
create policy "bonded creators of certified works" on public.bonded_creators for select
  using (exists (select 1 from public.works w where w.id = bonded_creators.work_id and w.status = 'certified'));

-- ─── 3b. Lo privado ──────────────────────────────────────────────────────────
create table if not exists public.bonded_private (
  work_id uuid primary key references public.works(id) on delete cascade,
  creator_contact text,
  estate_contact text,
  doc_type text check (doc_type is null or doc_type in ('bill', 'gallery', 'auction', 'inherit', 'gift', 'none')),
  source text,
  acquired text,
  price_paid text,
  doc_path text,
  provenance text,
  created_at timestamptz not null default now()
);

comment on table public.bonded_private is
  'Lo que el coleccionista aporta y nunca se publica: contactos de terceros, procedencia, lo que pagó, el documento (bucket privado; a la cadena solo su hash). Solo service role.';

alter table public.bonded_private enable row level security;
revoke all on public.bonded_private from anon, authenticated;

-- ─── 4. La lista de supresión ────────────────────────────────────────────────
create table if not exists public.contact_suppressions (
  contact_hash text primary key,
  kind text not null check (kind in ('email', 'phone')),
  created_at timestamptz not null default now()
);

comment on table public.contact_suppressions is
  'Contactos que pidieron no ser contactados. Solo el hash del contacto normalizado. Un contacto de tercero que coincide no se guarda. Solo service role.';

alter table public.contact_suppressions enable row level security;
revoke all on public.contact_suppressions from anon, authenticated;
