-- ============================================================================
-- 002_webauthn.sql — Credenciales biométricas (WebAuthn / passkeys)
-- ============================================================================
-- Fuente: TBT_Biometric_Handoff.docx §4 y Build Spec 01, ÍTEM 6.
--
-- El biométrico se SUMA al OTP telefónico, nunca lo reemplaza. El OTP sigue
-- siendo la prueba de identidad primaria y el ancla de recuperación de cuenta.
-- La huella/rostro nunca llega al servidor: solo guardamos la clave pública.
--
-- Aplicar ANTES de habilitar la fila de biométrico en el hub de autenticación.
-- ============================================================================

-- ── Credenciales por dispositivo ──────────────────────────────────────────
create table if not exists public.webauthn_credentials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  credential_id   text not null unique,            -- base64url
  public_key      bytea not null,                  -- clave pública COSE
  sign_count      bigint not null default 0,
  transports      text[],                          -- p.ej. {internal}
  device_label    text,                            -- "iPhone 15", "MacBook"
  bio_mode        text not null default 'quick',   -- quick | extra
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);

create index if not exists webauthn_credentials_user_id_idx
  on public.webauthn_credentials (user_id);

alter table public.webauthn_credentials enable row level security;

drop policy if exists "own credentials" on public.webauthn_credentials;
create policy "own credentials" on public.webauthn_credentials
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on column public.webauthn_credentials.bio_mode is
  'quick = la aserción biométrica basta para iniciar sesión en ese dispositivo. '
  'extra = se exige OTP Y biométrico. Se DEBE aplicar server-side, nunca confiar en el cliente.';

comment on column public.webauthn_credentials.sign_count is
  'Contador de firmas del autenticador. Si un login devuelve un contador que NO es mayor '
  'al guardado (y ambos son distintos de cero), tratar como posible autenticador clonado: '
  'rechazar y emitir evento de "actividad sospechosa".';

-- ── Retos (challenges): un solo uso y vida corta ──────────────────────────
create table if not exists public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  challenge   text not null,
  kind        text not null,                       -- registration | authentication
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists webauthn_challenges_user_id_idx
  on public.webauthn_challenges (user_id);
create index if not exists webauthn_challenges_expires_at_idx
  on public.webauthn_challenges (expires_at);

alter table public.webauthn_challenges enable row level security;
-- Sin políticas: solo el service-role (que omite RLS) crea y consume retos.
-- NUNCA confiar en un challenge devuelto por el cliente sin verificarlo server-side.

comment on table public.webauthn_challenges is
  'Retos WebAuthn de un solo uso y TTL corto. Solo service-role escribe/lee (RLS sin políticas).';
