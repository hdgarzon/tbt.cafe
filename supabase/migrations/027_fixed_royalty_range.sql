-- ============================================================================
-- 027_fixed_royalty_range.sql — Una regalia fija podia desbordar la columna
-- ============================================================================
-- Reconciliation 01, F3.
--
-- `work_commerce.royalty_value` era numeric(5,2): maximo representable 999.99.
-- Correcto para un porcentaje, equivocado para una regalia FIJA, que el modelo
-- define como un monto absoluto en dolares. `initial_price` en la misma tabla
-- ya era numeric(12,2), asi que la obra podia valer un millon y su regalia no
-- podia pasar de mil.
--
-- Nada lo atrapaba antes del fallo: `valid_royalty_fixed` solo comprueba >= 0,
-- y `fees.ts` calcula sin techo. El primer aviso era un `numeric field
-- overflow` de Postgres al escribir — en la fase de comercio de un registro,
-- delante de la persona, sin nada accionable en el mensaje.
--
-- Una regalia fija de $2.000 sobre una obra de $50.000 es un caso ordinario de
-- este producto, no un extremo.
--
-- EL TECHO DEL PORCENTAJE YA EXISTE Y SIGUE DONDE DEBE
--
-- `valid_royalty_percentage` ya limita a 50 cuando el tipo es porcentaje. Ese
-- limite pertenece a la restriccion, no al tipo: el tipo describe que cabe en
-- la columna, la restriccion describe que tiene sentido para el negocio.
-- Ensanchar el tipo no afloja el porcentaje.
--
-- No destructiva: ensanchar numeric no pierde datos.
-- ============================================================================

alter table public.work_commerce
  alter column royalty_value type numeric(12,2);

comment on column public.work_commerce.royalty_value is
  'Canonico (Spec 01, item 1): el porcentaje o el monto fijo, segun royalty_type. numeric(12,2) para que una regalia fija pueda ser un monto real; el tope de 50 para porcentajes vive en valid_royalty_percentage.';
