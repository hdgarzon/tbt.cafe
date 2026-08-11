-- Step-up de administración — Backend Spec 07 §1.4.
--
-- El acceso de administración exige biométrico + código privado, sea cual sea
-- el valor de la acción, y las sesiones son cortas y se revalidan en lo de alto
-- riesgo.
--
-- UNA PRECAUCIÓN QUE NO ESTÁ EN EL SPEC PERO HACE FALTA:
--
-- El código privado tiene entre 3 y 5 caracteres. El propio código de la app lo
-- describe como "una capa de conveniencia, NO un segundo factor real". Cuatro
-- dígitos son diez mil combinaciones: sin limitar intentos, esto sería un
-- candado forzable a mano sobre la superficie más privilegiada del producto.
--
-- Por eso los intentos se cuentan y se bloquean. El biométrico es el factor
-- fuerte; el código privado, sin freno, no aporta casi nada.

create table if not exists public.admin_step_up (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Se guarda el hash del token, no el token: quien pueda leer la tabla no debe
  -- poder usarla para entrar.
  token_hash text not null unique,
  -- Qué factores se presentaron de verdad. El spec pide los dos.
  used_biometric boolean not null default false,
  used_private_code boolean not null default false,
  -- Sesión corta a propósito.
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);

create index if not exists admin_step_up_user_idx on public.admin_step_up (user_id, expires_at desc);

alter table public.admin_step_up enable row level security;
-- Nadie lo lee desde el cliente. Se emite y se valida en el servidor.
revoke all on public.admin_step_up from anon, authenticated;

-- Control de intentos del código privado. Por usuario, no por IP: quien ataca
-- puede cambiar de IP, no de a quién ataca.
create table if not exists public.private_code_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_count int not null default 0,
  last_failed_at timestamptz,
  -- Mientras esto esté en el futuro, no se acepta ningún intento.
  locked_until timestamptz
);

alter table public.private_code_attempts enable row level security;
revoke all on public.private_code_attempts from anon, authenticated;

/**
 * Registra un intento fallido y bloquea al quinto.
 *
 * El bloqueo crece con los fallos acumulados en vez de ser fijo: un dedo torpe
 * espera un minuto, alguien probando diez mil combinaciones se detiene.
 */
create or replace function public.private_code_register_failure(who uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  attempts int;
  lock_until timestamptz;
begin
  insert into public.private_code_attempts (user_id, failed_count, last_failed_at)
  values (who, 1, now())
  on conflict (user_id) do update
    set failed_count = public.private_code_attempts.failed_count + 1,
        last_failed_at = now()
  returning failed_count into attempts;

  if attempts >= 5 then
    lock_until := now() + (least(attempts - 4, 30) * interval '1 minute');
    update public.private_code_attempts set locked_until = lock_until where user_id = who;
    return lock_until;
  end if;

  return null;
end;
$$;

/** Un acierto limpia el contador: los fallos que importan son los seguidos. */
create or replace function public.private_code_clear_failures(who uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.private_code_attempts
     set failed_count = 0, locked_until = null
   where user_id = who;
$$;
