-- Registraciones cubiertas — Backend Spec 01 §1.5.
--
-- Las primeras N registraciones de cada creador las paga tbt.cafe. Es un
-- programa de adquisición y un costo deliberado: la exposición agregada no
-- tiene tope (5.000 creadores × 10 = $400.000 absorbidos), y el control es el
-- interruptor de apagado.
--
-- El costo absorbido se registra como una transacción que ocurrió y que
-- tbt.cafe asumió — nunca como un cobro ausente. Tiene que ser contable y
-- exportable.

-- Los dos controles del programa. Una sola fila. Viven en la base y no en
-- variables de entorno porque el spec pide poder detener el programa sin un
-- despliegue; el Área 7 (herramienta de administración) los edita.
create table if not exists public.platform_config (
  id boolean primary key default true check (id),
  -- Interruptor: detiene asignaciones NUEVAS sin tocar las ya otorgadas.
  covered_brews_enabled boolean not null default true,
  covered_brews_count int not null default 10 check (covered_brews_count >= 0),
  updated_at timestamptz not null default now()
);
insert into public.platform_config (id) values (true) on conflict (id) do nothing;

alter table public.platform_config enable row level security;

-- Cualquiera autenticado puede leer los dos números: la pantalla de pago
-- necesita saber si esta registración va cubierta. Solo el service role escribe.
drop policy if exists "config readable" on public.platform_config;
create policy "config readable" on public.platform_config
  for select using (true);

-- Concesión individual: permite a soporte regalar registraciones extra a una
-- persona sin mover el valor global.
alter table public.profiles
  add column if not exists covered_registrations_granted int not null default 0;

-- El libro de costo absorbido. Se escribe SOLO cuando la registración se
-- completó: un intento abandonado o bloqueado no descuenta la asignación.
--
-- Este libro es además el contador. No hay una columna "usadas" que pueda
-- quedar desfasada respecto a él: lo consumido es el número de filas.
create table if not exists public.covered_registrations (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  work_id uuid references public.works(id) on delete set null,
  -- Lo que se HABRÍA cobrado, no cero.
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  reason text not null check (reason in ('first_n_allowance', 'admin_grant')),
  created_at timestamptz not null default now()
);

create index if not exists covered_registrations_creator_idx
  on public.covered_registrations (creator_id);

-- Una obra no puede consumir la asignación dos veces.
create unique index if not exists covered_registrations_work_idx
  on public.covered_registrations (work_id) where work_id is not null;

alter table public.covered_registrations enable row level security;

-- El creador ve lo suyo. La escritura es solo del service role: si el cliente
-- pudiera insertar, podría regalarse registraciones.
drop policy if exists "creator reads own covered" on public.covered_registrations;
create policy "creator reads own covered" on public.covered_registrations
  for select using (auth.uid() = creator_id);
