-- ============================================================================
-- 056_email_verification.sql — El e-Mail se verifica con un código
-- ============================================================================
-- Work Order 01 Step 19, como lo reemplaza el Addendum A: la doble entrada se
-- retira; la dirección se pide una vez y se verifica con un código enviado a
-- ella. El campo pasa a llamarse e-Mail (Set 3). Las columnas
-- `recovery_email` y `recovery_email_verified` no cambian de nombre.
--
-- Antes, la hoja llamaba a `supabase.auth.updateUser({ email })`, que manda un
-- ENLACE y ata la dirección a la identidad de auth, y nada volvía a poner
-- `recovery_email_verified` en true. Con el biométrico como segundo factor
-- solamente (D1), el e-Mail no necesita ser una identidad de auth.
--
-- Un código por solicitud: se guarda su hash, nunca el código; caduca a los
-- 10 minutos y admite 5 intentos. Solo el servidor lee y escribe la tabla.
-- No destructiva.
-- ============================================================================

create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verifications_user_idx
  on public.email_verifications (user_id, created_at desc);

comment on table public.email_verifications is
  'Códigos para verificar el e-Mail (Step 19). Solo el hash; 10 minutos; 5 intentos. Solo service role.';

alter table public.email_verifications enable row level security;
revoke all on public.email_verifications from anon, authenticated;
