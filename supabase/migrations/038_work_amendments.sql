-- ============================================================================
-- 038_work_amendments.sql — El registro que supersede
-- ============================================================================
-- Chain Implementation Spec 01, Item 5.
--
-- Un registro no se edita nunca. Una correccion es un registro NUEVO que nombra
-- al que supersede: el mas reciente es el vigente por definicion, el original
-- sigue legible para siempre, y la cadena entre los dos es el historial. Esta
-- tabla es esa cadena del lado de aca; el enlace de verdad va DENTRO del
-- registro publicado, en su campo `supersedes`.
--
-- DOS CADENAS, UN TBT
--
-- Registracion y procedencia son listas enlazadas SEPARADAS bajo el mismo TBT.
-- Una transferencia jamas toca la cadena de registracion, y una enmienda jamas
-- toca la de procedencia. Por eso esto no vive en `ownership_history`.
--
-- LA VIGENTE ES POR SECUENCIA, NUNCA POR FECHA
--
-- Los relojes se desvian y las marcas de tiempo colisionan. La registracion es
-- la secuencia 1; la primera enmienda, la 2. `works.registration_record_uri`
-- apunta siempre a la cabeza, que es lo que siguen el minteo y el libro de la
-- obra.
--
-- SOLO LA CLASE MINOR ESTA CONSTRUIDA
--
-- La columna admite `authorship` porque el registro publicado lo admite, pero
-- ese camino no existe todavia: si la obra superseida ya se vendio, quedan en el
-- aire si la regalia sigue a la autoria, que tiene el coleccionista y si la
-- venta se sostiene. Es la pregunta 30 para asesoria legal.
--
-- No destructiva.
-- ============================================================================

create table if not exists public.work_amendments (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete restrict,
  tbt_id text not null,

  sequence_number integer not null,
  record_uri text not null,
  record_hash text not null,

  -- A quien supersede. La URI es la que viaja dentro del registro publicado; el
  -- hash queda al lado para poder comprobar sin descargar.
  supersedes_uri text not null,
  supersedes_hash text not null,

  amendment_class text not null check (amendment_class in ('minor', 'authorship')),
  amendment_reason text not null,
  -- Que cambio, campo a campo. Es para el panel y la bitacora: lo que vale como
  -- prueba es el registro publicado, no esta columna.
  changed jsonb not null default '{}'::jsonb,

  -- Toda enmienda es de alto riesgo (Spec 07 §1.3): dos personas distintas, y
  -- las dos van nombradas —en seudonimo— dentro del registro publicado.
  initiated_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  approval_id uuid references public.admin_pending_approvals(id),

  -- Cuando el activo de Solana paso a apuntar al registro nuevo. Nula si el
  -- repunte fallo: la enmienda vale igual —ya esta publicada y anclada— y el
  -- puntero se puede mover despues.
  repointed_at timestamptz,
  created_at timestamptz not null default now(),

  unique (tbt_id, sequence_number),
  constraint amendment_approver_is_not_initiator check (approved_by <> initiated_by)
);

create index if not exists work_amendments_work_idx
  on public.work_amendments (work_id, sequence_number desc);

-- Como `chain_anchors`: se escribe y se lee desde el servidor. Lo que el
-- publico ve es la proyeccion que compone el libro de la obra, no la fila.
alter table public.work_amendments enable row level security;

comment on table public.work_amendments is
  'Cadena de correcciones de la registracion. Un registro no se edita: se supersede. Item 5.';
comment on column public.work_amendments.repointed_at is
  'Cuando el NFT paso a apuntar al registro nuevo. Nula = el puntero sigue en el anterior y hay que moverlo.';
