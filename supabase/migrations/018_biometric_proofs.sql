-- Prueba de biométrico — Backend Spec 07 §1.4.
--
-- El step-up recibía `{ code, biometric: true }` y se creía el booleano. El
-- WebAuthn se verificaba en otra ruta y nada ataba las dos cosas, así que un
-- POST directo con `biometric: true` saltaba el sensor entero y dejaba como
-- único obstáculo un código de 3 a 5 caracteres.
--
-- Una comprobación que el cliente puede afirmar por su cuenta no es una
-- comprobación. Ahora `/api/webauthn/auth/finish` —que sí verifica la aserción—
-- emite una prueba, y el step-up la exige.

create table if not exists public.biometric_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Hash del token, no el token: poder leer la tabla no debe servir para pasar.
  token_hash text not null unique,
  -- Se gasta al usarse. Una prueba no vale para dos step-ups.
  consumed_at timestamptz,
  -- Corta de verdad: es el puente entre poner el dedo y escribir el código.
  expires_at timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now()
);

create index if not exists biometric_proofs_user_idx
  on public.biometric_proofs (user_id, expires_at desc);

alter table public.biometric_proofs enable row level security;
-- Nadie la lee ni la escribe desde el cliente. Se emite y se consume en el servidor.
revoke all on public.biometric_proofs from anon, authenticated;

/**
 * Consume una prueba, o devuelve false.
 *
 * Atómico: marca `consumed_at` en la misma sentencia que la valida, para que dos
 * peticiones simultáneas no puedan gastar la misma.
 */
create or replace function public.consume_biometric_proof(who uuid, hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hit uuid;
begin
  update public.biometric_proofs
     set consumed_at = now()
   where token_hash = hash
     and user_id = who
     and consumed_at is null
     and expires_at > now()
  returning id into hit;

  return hit is not null;
end;
$$;
