-- ============================================================================
-- 040_two_phase_recipient_nullable.sql — el destinatario aún no existe
-- ============================================================================
-- En una transferencia de dos fases el recipiente NO tiene cuenta cuando se
-- crea la fila: recibe un SMS con un enlace y decide después. Por eso
-- transfer/create inserta `to_owner_id: null` a propósito, y solo se rellena
-- cuando acepta.
--
-- Pero `to_owner_id` quedó NOT NULL. La 010 añadió las cuatro columnas del
-- flujo de dos fases y no relajó esta, así que TODA transferencia moría con
-- 23502 y la pantalla decía «We couldn't start the transfer». Encontrado en
-- una prueba en vivo — el tercer motivo, tras las columnas que faltaban, por
-- el que este flujo nunca pudo funcionar.
--
-- No se quita la garantía, se acota: nula SOLO cuando la fila es de dos fases.
-- Una transferencia de una fase sin destinatario sigue siendo imposible, que
-- es lo que la restricción original protegía.
-- ============================================================================

alter table public.transfers
  alter column to_owner_id drop not null;

alter table public.transfers
  drop constraint if exists transfers_recipient_required_unless_two_phase;

alter table public.transfers
  add constraint transfers_recipient_required_unless_two_phase
  check (to_owner_id is not null or is_two_phase);

comment on constraint transfers_recipient_required_unless_two_phase on public.transfers is
  'to_owner_id solo puede ser nulo en filas de dos fases, donde el recipiente aun no tiene cuenta. Se rellena al aceptar.';
