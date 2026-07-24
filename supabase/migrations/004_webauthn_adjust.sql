-- ============================================================================
-- 004_webauthn_adjust.sql — Ajustes para el enrolamiento biométrico de tbt.cafe
-- ============================================================================
-- Dos cambios para que el front nuevo pueda hacer el enrolamiento WebAuthn con
-- la sesión del propio usuario, SIN necesitar la service-role key:
--
--   1. public_key: bytea → text (base64url). bytea es incómodo vía PostgREST /
--      supabase-js; una clave pública COSE en base64url text round-trip-ea sin
--      dolor. La tabla está vacía, así que el USING es un no-op.
--
--   2. RLS de retos por fila propia. La 002 dejó webauthn_challenges sin
--      políticas (solo service-role). Con esta política, cada usuario gestiona
--      SUS retos con su token — el reto sigue siendo aleatorio, de un solo uso
--      y ligado al usuario, así que la propiedad de seguridad se mantiene.
-- ============================================================================

alter table public.webauthn_credentials
  alter column public_key type text using encode(public_key, 'base64');

comment on column public.webauthn_credentials.public_key is
  'Clave pública COSE en base64url (era bytea; migrada a text en 004).';

drop policy if exists "own challenges" on public.webauthn_challenges;
create policy "own challenges" on public.webauthn_challenges
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
