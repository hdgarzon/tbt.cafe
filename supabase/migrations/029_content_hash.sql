-- ============================================================================
-- 029_content_hash.sql — El hash del archivo de origen
-- ============================================================================
-- Chain Implementation Spec 01, Item 2.
--
-- SHA-256 del archivo tal como se subio, antes de cualquier proceso. No la
-- imagen normalizada, no la miniatura, y no el hash perceptual de la ruta de
-- registro de imagenes: aquel mide parecido y sirve para otra cosa.
--
-- Es lo que hace el certificado autoverificable: quien conserve el original
-- puede probar que coincide con el registro, con o sin tbt.cafe. Sin esto, el
-- certificado depende para siempre de que la plataforma responda por el.
--
-- EL INDICE NO ES PARA BUSCAR RAPIDO
--
-- Es para que una subida byte a byte identica se pueda detectar al registrar.
-- No es un sustituto del escaneo de plagio —ese mide parecido, este exige
-- igualdad exacta— sino el caso trivial que el otro no deberia tener que
-- resolver.
--
-- NO SE PUEDE ANADIR RETROACTIVAMENTE. Las 58 obras ya registradas se quedan
-- sin el para siempre: sus bytes de origen no existen en ningun sitio nuestro.
-- Es la razon de que este item vaya segundo y de que los mints de devnet se
-- traten como desechables.
--
-- No destructiva.
-- ============================================================================

alter table public.works
  add column if not exists content_hash text;

create index if not exists works_content_hash_idx
  on public.works (content_hash) where content_hash is not null;

comment on column public.works.content_hash is
  'SHA-256 del archivo de origen con prefijo sha256:, tomado en el cliente antes de normalizar. Nulo en las obras anteriores al 27 ago 2026: no se puede calcular despues.';
