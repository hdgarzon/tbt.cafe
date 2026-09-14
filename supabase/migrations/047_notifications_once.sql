-- ============================================================================
-- 047_notifications_once.sql — Una notificacion se escribe una vez
-- ============================================================================
-- Work Order 01, Step 21: el punto de partida.
--
-- `notify()` hacia un insert sin mas, y nada en la tabla impedia que el mismo
-- aviso entrara dos veces. Entraba. Cuando un MMS fallaba, `twilio/status` abria
-- el ticket de sistema —que ya avisa— y despues volvia a avisar por su cuenta,
-- una vez mas por cada callback repetido de Twilio. Los webhooks de Stripe se
-- reintentan igual: cada aviso de pago que se conecte despues heredaria el fallo.
--
-- UNA CLAVE POR HECHO
--
-- `dedupe_key` nombra el hecho que se avisa —la obra registrada, la respuesta
-- del equipo, el ticket abierto—, no el intento. El indice unico sobre
-- (persona, evento, clave) hace que el segundo intento choque, y `notify()` lee
-- ese choque como "ya avisado": no escribe otra fila ni manda otro correo.
--
-- Parcial a proposito: las filas anteriores no tienen clave y no se tocan.
--
-- LA PERSONA SOLO PUEDE MARCAR COMO LEIDA
--
-- La politica de actualizacion de la 015 dice "solo puede marcarlas como
-- leidas", pero la RLS filtra FILAS, no columnas: cualquiera con sesion podia
-- reescribir el evento, los datos o el enlace de sus propias notificaciones. Con
-- una clave de deduplicacion eso deja de ser feo y pasa a ser peligroso: bastaria
-- con reescribir una notificacion vieja para que coincida con un aviso futuro de
-- cambio de destino de cobro, y ese aviso —que no se puede apagar precisamente
-- para que nadie lo silencie— chocaria con el indice y no se escribiria.
--
-- Asi que el privilegio baja a la columna. `authenticated` conserva UPDATE solo
-- sobre `read_at`, que es lo unico que la aplicacion toca
-- (NotificationFeed.markAllRead). Insertar y borrar ya los negaba la RLS por
-- falta de politica; se retiran tambien como privilegio, para que no dependan de
-- que nadie añada una politica sin pensar.
-- ============================================================================

begin;

alter table public.notifications add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_idx
  on public.notifications (user_id, event_key, dedupe_key)
  where dedupe_key is not null;

revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

comment on column public.notifications.dedupe_key is
  'El hecho que se avisa: la obra registrada, la respuesta, el ticket. Con (user_id, event_key) es unico, asi que un reintento no escribe dos veces ni manda dos correos.';

do $$
declare
  c record;
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'notifications_dedupe_idx'
  ) then
    raise exception 'falta notifications_dedupe_idx';
  end if;

  for c in
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications' and column_name <> 'read_at'
  loop
    if has_column_privilege('authenticated', 'public.notifications', c.column_name, 'UPDATE') then
      raise exception 'authenticated todavia puede reescribir notifications.%', c.column_name;
    end if;
  end loop;

  if not has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE') then
    raise exception 'authenticated ya no puede marcar una notificacion como leida';
  end if;
  if has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.notifications', 'DELETE')
     or has_table_privilege('anon', 'public.notifications', 'UPDATE') then
    raise exception 'quedan privilegios de escritura para el cliente';
  end if;
end $$;

commit;
