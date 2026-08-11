-- Feed de notificaciones — Backend Spec 06 §1.1.
--
-- El feed dentro de la app es EL CANAL DE REGISTRO: todo el mundo recibe todas
-- sus notificaciones aquí, tenga correo o no. Por eso el correo puede seguir
-- siendo opcional sin dejar a nadie incomunicado — es alcance adicional, nunca
-- el único medio.
--
-- No se guarda el texto ya traducido, sino la CLAVE del evento y sus datos. El
-- idioma se resuelve al pintar: así, si alguien cambia de idioma, su historial
-- entero cambia con él en vez de quedar congelado en el idioma que tenía el día
-- que ocurrió cada cosa.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Coincide con los identificadores de las preferencias: 'purchases',
  -- 'offer_received', 'ticket_reply', 'payout_failed'…
  event_key text not null,
  category text not null check (category in ('tbt', 'security', 'transactional', 'support', 'payouts')),
  -- Datos para rellenar la plantilla traducida: títulos de obra, importes, refs.
  params jsonb not null default '{}'::jsonb,
  -- Ruta interna a la que lleva, si la hay.
  href text,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
-- Para el punto rojo del icono: cuenta de no leídas sin recorrer todo.
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Cada quien ve las suyas.
drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read" on public.notifications
  for select using (auth.uid() = user_id);

-- Solo puede marcarlas como leídas. La escritura la hace el servidor: si el
-- cliente pudiera insertar, cualquiera podría fabricarse un aviso de seguridad
-- que parezca de la plataforma.
drop policy if exists "own notifications mark read" on public.notifications;
create policy "own notifications mark read" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

/**
 * Preferencia de un ítem para una persona.
 *
 * Las protectoras (§5.3) NO se consultan aquí: quien las escribe no pregunta,
 * porque no se pueden silenciar. Un atacante capaz de apagar el aviso de cambio
 * de destino de cobro podría redirigir fondos sin que nadie se entere.
 *
 * Para las demás, el silencio del usuario significa el valor por defecto, y el
 * defecto es recibirlas: alguien que nunca abrió los ajustes no debería quedarse
 * sin enterarse de una venta.
 */
create or replace function public.notification_enabled(who uuid, item text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (prefs -> item ->> 'on')::boolean
       from public.notification_prefs where user_id = who),
    true
  );
$$;
