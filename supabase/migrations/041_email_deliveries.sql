-- ============================================================================
-- 041_email_deliveries.sql — El correo tambien tiene que poder decir que NO
-- ============================================================================
-- El MMS lleva libro desde que se descubrio que Twilio ACEPTA un mensaje y
-- decide despues si lo entrega: `mms_deliveries` guarda cada intento con su
-- estado, y por eso hoy se puede leer en la base que ningun certificado ha
-- salido nunca por ese canal.
--
-- El correo no tenia nada. `send-email` distingue bien las tres cosas —enviado,
-- fallido, simulado— y devuelve cada una con su codigo, pero no escribia en
-- ningun sitio: la respuesta HTTP se la lleva quien llamo y ahi muere. Con el
-- proveedor ya configurado en produccion, la unica forma de saber si un
-- certificado llego era preguntarselo al panel de Resend.
--
-- Esta tabla cierra ese hueco con la misma forma que la del MMS, para que las
-- dos se lean igual.
--
-- SIMULADO ES UN ESTADO, NO UN EXITO
--
-- Fuera de produccion, sin RESEND_API_KEY, la ruta responde `simulated: true` a
-- proposito: simular no es enviar. El libro lo anota como 'simulated' y no como
-- 'sent', porque una tabla que llame envio a lo que nadie recibio repite el
-- fallo que vino a registrar.
--
-- LA ESCRIBE LA PLATAFORMA
--
-- Igual que en `mms_deliveries`: la fila entra con el cliente de servicio. Con
-- el token del usuario la RLS la deniega y el libro queda vacio — que es
-- exactamente como estaba. La politica de lectura sigue siendo del usuario:
-- cada quien ve las entregas de lo suyo.
--
-- No destructiva. No toca ninguna fila existente.
-- ============================================================================

create table if not exists public.email_deliveries (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid,
  user_id uuid,
  email text not null,
  resend_message_id text,
  status text default 'pending'::text,
  certificate_url text,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_deliveries_pkey') then
    alter table public.email_deliveries add constraint email_deliveries_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_deliveries_work_id_fkey') then
    alter table public.email_deliveries add constraint email_deliveries_work_id_fkey
      foreign key (work_id) references public.works(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_deliveries_user_id_fkey') then
    alter table public.email_deliveries add constraint email_deliveries_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_email_deliveries_work_id
  on public.email_deliveries using btree (work_id);

-- DOS INDICES, NO UNO.
--
-- `mms_deliveries` solo indexa work_id, y por eso arrastra dos costes que aqui
-- no se repiten: user_id es clave foranea con `on delete cascade` —borrar un
-- perfil recorre la tabla entera— y ademas es la columna por la que filtra la
-- politica de lectura, que sin indice se evalua fila a fila.
create index if not exists idx_email_deliveries_user_id
  on public.email_deliveries using btree (user_id);

alter table public.email_deliveries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'email_deliveries'
       and policyname = 'Users can view their email deliveries'
  ) then
    -- `(select auth.uid())` y no `auth.uid()` a secas: envuelta en un SELECT se
    -- evalua una vez por consulta en lugar de una vez por fila. La politica del
    -- MMS tiene la forma antigua; esta no la copia.
    create policy "Users can view their email deliveries"
      on public.email_deliveries for select using (user_id = (select auth.uid()));
  end if;
end $$;

comment on table public.email_deliveries is
  'Un intento de entrega por correo, con su desenlace. Espejo de mms_deliveries: sin esto no habia forma de saber en la base si un certificado salio.';
comment on column public.email_deliveries.status is
  'sent | failed | simulated. Simulado no es enviado: fuera de produccion, sin proveedor, la ruta simula a proposito y aqui se anota como tal.';
comment on column public.email_deliveries.resend_message_id is
  'El id que devuelve Resend al aceptar. Aceptado no es entregado; sirve para rastrear el mensaje en el proveedor.';
comment on column public.email_deliveries.error_message is
  'Lo que dijo el proveedor al rechazar, o el motivo interno. Sin esto un fallo es indistinguible de no haberlo intentado.';
comment on column public.email_deliveries.delivered_at is
  'Reservada. Resend confirma la entrega por webhook, que todavia no existe; hasta entonces queda nula igual que en el MMS.';
