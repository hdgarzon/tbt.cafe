-- ============================================================================
-- 053_profiles_private_columns.sql — Un perfil público no lleva los datos privados
-- ============================================================================
-- La política "Perfiles visibles públicamente" es `for select using (true)`, y
-- `anon` y `authenticated` tenían SELECT sobre la tabla entera. La RLS filtra
-- filas, no columnas: cualquiera con la clave anónima —la que lleva cada
-- navegador— podía pedir a PostgREST el teléfono, el e-Mail, la dirección, el
-- documento fiscal, el nombre legal y el hash del código privado de todas las
-- personas. El código privado tiene de 3 a 5 caracteres; su hash se revierte
-- por fuerza bruta.
--
-- Ahora:
--   - la lectura de la tabla se retira a `anon` y `authenticated`, y se devuelve
--     columna por columna, solo las que una página pública muestra;
--   - las privadas no se conceden a nadie del lado del cliente. Una columna que
--     se añada después tampoco: el permiso por columna es cerrado por defecto;
--   - cada persona lee las suyas con `my_profile_private()`, que deriva a quién
--     responde de `auth.uid()` y nunca de un argumento, y que no devuelve el hash
--     del código privado sino si existe.
--
-- El servidor (service role) no cambia: sigue leyendo todo.
-- No destructiva: no toca filas.
-- ============================================================================

revoke select on public.profiles from anon, authenticated;

grant select (
  id, display_name, public_alias, avatar_url, bio,
  creator_type, creator_category, is_creator, credentials,
  collective_name, entity_name, lead_representative, corporate_title,
  collector_alias, collector_anonymous, collector_about, collector_category,
  collector_location, collector_website,
  social_facebook, social_instagram, social_linkedin, social_other, social_website, social_youtube,
  language_override, payout_country, covered_registrations_granted,
  created_at, updated_at
) on public.profiles to anon, authenticated;

-- Los datos privados de quien pregunta, y de nadie más.
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
    'private_code_freq', p.private_code_freq
  )
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke execute on function public.my_profile_private() from public, anon, authenticated;
grant execute on function public.my_profile_private() to authenticated;

comment on function public.my_profile_private() is
  'Los datos privados del perfil de quien llama (auth.uid()). No devuelve private_code_hash, solo si existe. 053.';
