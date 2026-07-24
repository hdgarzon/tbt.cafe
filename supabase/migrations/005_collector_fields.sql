-- ============================================================================
-- 005_collector_fields.sql — Campos del perfil de coleccionista (Master Handoff §11.2)
-- ============================================================================
-- La 001 añadió collector_alias y collector_anonymous, pero el perfil de
-- coleccionista del spec tiene su propia identidad-display: categoría,
-- ubicación, about y links. Se guardan como columnas escalares en profiles,
-- consistente con el enfoque de la 001. No destructiva.
--
-- Nota: el creador ya reutiliza las columnas ricas existentes (legal_name,
-- public_alias, bio, social_*, physical_address, credentials). Estas son el
-- juego PARALELO para el coleccionista, que puede coexistir con el de creador
-- en la misma fila ("either or both").
-- ============================================================================

alter table public.profiles
  add column if not exists collector_category text,   -- individual|group|corporation
  add column if not exists collector_location text,
  add column if not exists collector_about    text,
  add column if not exists collector_website  text;

comment on column public.profiles.collector_anonymous is
  'Si es true, la página del TBT muestra "Private collector" y se atenúan los '
  'campos de identidad (alias, ubicación, about, links). La categoría se mantiene visible.';
