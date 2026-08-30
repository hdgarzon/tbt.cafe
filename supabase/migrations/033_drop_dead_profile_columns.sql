-- ============================================================================
-- 033_drop_dead_profile_columns.sql — Las tres gemelas de profiles
-- ============================================================================
-- DESTRUCTIVA, aunque las tres columnas estan vacias en las 14 filas.
--
-- EL CRITERIO NO ES EL VACIO
--
-- `profiles` tenia 42 columnas y 18 sin un solo valor. Casi todas estan VIVAS:
-- son campos opcionales de perfil que nadie ha rellenado todavia —payout_country,
-- recovery_email, language_override, los de coleccionista, los de persona
-- juridica—. Vacio significa "aun nadie lo escribio", no "nada lo usa".
--
-- Asi que se cruzo cada una contra el codigo, no contra los datos. Solo tres no
-- aparecen en ninguna linea de `src/` ni de `scripts/`, ni en snake_case ni en
-- camelCase.
--
-- Y las tres son el mismo caso que en `works`: la mitad que perdio de un par.
--
--   viva                     muerta                 quien escribe la viva
--   bio                      about_creator          complete-tbt, desde
--                                                   `creatorData.aboutCreator`
--   legal_name               legal_name_full        complete-tbt
--   lead_representative      representative_name    complete-tbt
--
-- El de `bio` es el mas ilustrativo: el formulario recoge un campo llamado
-- `aboutCreator` y lo guarda en `bio`, mientras `about_creator` —que se llama
-- igual que el campo— nunca recibe nada. Un nombre que coincide y una columna
-- que no es.
--
-- QUE NO SE TOCA
--
-- Las otras 15 vacias se quedan enteras. Borrar un campo de perfil porque
-- ningun usuario lo ha rellenado seria confundir "sin usar" con "sin estrenar".
-- ============================================================================

alter table public.profiles drop column if exists about_creator;
alter table public.profiles drop column if exists legal_name_full;
alter table public.profiles drop column if exists representative_name;
