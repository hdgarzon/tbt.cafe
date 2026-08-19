-- ============================================================================
-- 001_account.sql — Campos y tablas de cuenta para tbt.cafe
-- ============================================================================
-- Fuente: TBT_Build_Spec_01.docx, ÍTEM 5.
--
-- No destructiva: solo ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- RLS espeja el patrón existente (cada usuario lee/escribe solo sus filas).
--
-- Aplicar ANTES de cablear las features de cuenta del front-end nuevo
-- (hub de autenticación, email de recuperación, código privado, perfiles,
-- notificaciones).
-- ============================================================================

-- ── Perfiles: identidad de creador + coleccionista, anonimato, idioma ──────
alter table public.profiles
  add column if not exists collector_alias           text,
  add column if not exists collector_anonymous       boolean not null default false,
  add column if not exists creator_category          text,     -- individual | group | corporation
  add column if not exists language_override         text,     -- en | es | pt | fr
  add column if not exists recovery_email            text,
  add column if not exists recovery_email_verified   boolean not null default false,
  add column if not exists private_code_hash         text,     -- SIEMPRE hasheado, nunca plaintext
  add column if not exists private_code_freq         text;     -- always | occasional

comment on column public.profiles.private_code_hash is
  'Hash (bcrypt/argon2) del código privado de 3-5 caracteres. Nunca guardar el valor en claro. '
  'Es una capa de conveniencia de baja entropía, NO un segundo factor real.';

comment on column public.profiles.collector_anonymous is
  'Si es true, la página del TBT muestra "Private collector" y se ocultan los campos de identidad.';

-- ── Preferencias de notificaciones (una fila por usuario) ──────────────────
create table if not exists public.notification_prefs (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  prefs       jsonb not null default '{}'::jsonb,   -- {itemId: {on: bool, threshold: int}}
  updated_at  timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists "own prefs" on public.notification_prefs;
create policy "own prefs" on public.notification_prefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.notification_prefs is
  'Preferencias de notificación por usuario. Las de seguridad van ON por defecto '
  '(nueva ubicación/IP, nuevo dispositivo, actividad sospechosa).';
