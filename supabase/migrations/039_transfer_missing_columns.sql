-- ============================================================================
-- 039_transfer_missing_columns.sql — las columnas que `transfers` nunca tuvo
-- ============================================================================
-- La 010 (two-phase transfer) las da por existentes en su cabecera: enumera
-- `from_owner_name`, `payment_amount` y `payment_currency` entre las columnas
-- que ya estaban, y por eso solo añadió las cuatro suyas. Esta base nunca las
-- tuvo. El código sí las usa:
--
--   transfer/create        las ESCRIBE en el insert
--   transfer/[transferId]  las LEE (la vista pública que abre el recipiente)
--   stripe/webhook         lee from_owner_name para el SMS de aviso
--
-- El efecto era que ninguna transferencia podía crearse: PostgREST devolvía
-- PGRST204 «Could not find the 'from_owner_name' column», la ruta respondía
-- 500 y la pantalla decía «We couldn't start the transfer». Encontrado en una
-- prueba en vivo, no en revisión: compila y despliega perfectamente.
--
-- Aditiva e idempotente. No toca filas existentes ni ninguna restricción.
-- ============================================================================

alter table public.transfers
  add column if not exists from_owner_name text,
  add column if not exists payment_amount numeric(12,2),
  add column if not exists payment_currency text;

comment on column public.transfers.from_owner_name is
  'Nombre de quien envía, congelado al crear la transferencia: el recipiente lo ve antes de tener cuenta, y no debe cambiar si el perfil cambia después.';
comment on column public.transfers.payment_amount is
  'Valor declarado de la transferencia (0 en un regalo). NO incluye la tarifa ni el procesamiento.';
comment on column public.transfers.payment_currency is
  'Moneda del valor declarado. USD hoy; la columna existe para no volver a migrar cuando deje de serlo.';
