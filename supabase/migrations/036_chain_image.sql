-- ============================================================================
-- 036_chain_image.sql — Que copia de la obra llega al registro permanente
-- ============================================================================
-- Chain Spec 01, Item 10. El spec deja este punto abierto —«Source file itself:
-- Decision required»— con una recomendacion: hashear siempre, publicar una
-- miniatura por legibilidad, y la resolucion completa solo donde el creador la
-- elija. Y pide para ello «a control in the brew flow».
--
-- POR DEFECTO NO SE PUBLICA NADA
--
-- El valor por defecto de la columna es 'none' aunque el asistente proponga
-- 'thumbnail'. No es una contradiccion: es que la decision tiene que venir de
-- una persona, y una ruta de codigo que olvide mandar el campo no puede acabar
-- publicando la obra de nadie en un almacen que no se puede borrar. Falla
-- cerrado.
--
-- Las 58 obras ya certificadas se quedan en 'none' y no se toca ninguna.
--
-- CUATRO COLUMNAS PORQUE SON CUATRO COSAS
--
--   chain_image        lo que el creador eligio.
--   chain_image_url    los bytes elegidos, en nuestro almacen. Para 'full' es
--                      el propio media_url; para 'thumbnail', la reduccion que
--                      el navegador genero al subir.
--   chain_image_uri    donde quedaron en Arweave. Se guarda ANTES de seguir,
--                      por lo mismo que registration_record_uri: un reintento
--                      tiene que agarrarse a la copia que ya existe en vez de
--                      subir una segunda que nada relaciona con la primera.
--   chain_image_hash   sha256 de LOS BYTES PUBLICADOS.
--
-- El ultimo NO es content_hash y no debe confundirse con el. content_hash es el
-- archivo tal como se subio, con sus metadatos, que solo tiene el creador y es
-- contra lo que se verifica el certificado. Lo publicado pasa antes por
-- stripMetadata —el EXIF de un telefono lleva coordenadas, y el Item 10 las
-- marca «Never»— y en cuanto se le quita un byte ya es otro archivo.
--
-- No destructiva.
-- ============================================================================

alter table public.works
  add column if not exists chain_image text not null default 'none',
  add column if not exists chain_image_url text,
  add column if not exists chain_image_uri text,
  add column if not exists chain_image_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'works_chain_image_check'
  ) then
    alter table public.works
      add constraint works_chain_image_check
      check (chain_image in ('none', 'thumbnail', 'full'));
  end if;
end $$;

comment on column public.works.chain_image is
  'Que copia de la obra se publica en Arweave: none | thumbnail | full. Lo elige el creador en el Sello; el valor por defecto no publica nada.';
comment on column public.works.chain_image_url is
  'Los bytes elegidos, en works-media. Para full es media_url; para thumbnail, la reduccion generada al subir.';
comment on column public.works.chain_image_uri is
  'Arweave. Se guarda antes de continuar para que un reintento la reutilice en vez de publicar una segunda copia.';
comment on column public.works.chain_image_hash is
  'sha256 de los bytes PUBLICADOS, ya sin metadatos. No es content_hash: aquel es el archivo de origen, que solo tiene el creador.';
