-- ============================================================================
-- 079_delivery_foundation.sql — Entrega fisica, los cimientos
-- ============================================================================
-- Work Order 02, Amendment Delivery 01 (decision 94), Stages 1 y 6.
--
-- tbt.cafe responde por la venta y el TBT, nunca por la obra fisica. En la via
-- de plataforma, cuando el comprador pidio "entregamelo", la ganancia de la
-- venta no se puede cobrar hasta que el vendedor de los datos de entrega. En la
-- via directa no se retiene nada. Transferencias y regalos no son ventas: nada
-- de esto les aplica.
--
-- Esta migracion pone los datos y la retencion. La eleccion la escribe el
-- checkout (el PR siguiente); hasta entonces ninguna venta tiene fila aqui y
-- nada cambia para nadie.
--
-- UNA TABLA PROPIA, NO COLUMNAS EN transfers
--
-- La politica de la base "Participantes pueden actualizar transferencias" deja
-- a comprador y vendedor escribir cualquier columna de su fila. Si la eleccion
-- viviera ahi, el vendedor podria cambiar "entregamelo" por "lo recojo" y soltar
-- su cobro sin enviar nada. `sale_deliveries` solo la escribe el servidor y solo
-- la leen comprador y vendedor de esa venta; la direccion no sale de ahi.
--
-- EL PLAZO
--
-- `delivery_details_deadline` son DIAS desde que la venta se completa. Sin
-- valor por defecto: lo fija Federico. Vacio, el barrido no abre nada.
--
-- Numerada 079: 077 (#171) y 078 (#172) estan abiertas. Si cambian, se renumera.
--
-- No destructiva.
-- ============================================================================

-- ── 1 · Configuracion ───────────────────────────────────────────────────────
alter table public.platform_config
  add column if not exists delivery_details_deadline integer;

alter table public.platform_config drop constraint if exists platform_config_delivery_details_deadline_check;
alter table public.platform_config add constraint platform_config_delivery_details_deadline_check
  check (delivery_details_deadline is null or delivery_details_deadline > 0);

comment on column public.platform_config.delivery_details_deadline is
  'Dias desde que se completa una venta con entrega pedida; pasado el plazo sin datos de entrega se abre un caso. Vacio: nunca. Lo fija Federico (decision 94).';

-- Como las demas reglas publicas (058): el navegador las lee por columna.
grant select (delivery_details_deadline) on public.platform_config to anon, authenticated;

-- ── 2 · La obra: fisica o digital ───────────────────────────────────────────
alter table public.works
  add column if not exists work_kind text;

alter table public.works drop constraint if exists works_work_kind_check;
alter table public.works add constraint works_work_kind_check
  check (work_kind is null or work_kind in ('physical', 'digital'));

comment on column public.works.work_kind is
  'Lo declara el vendedor al publicar (decision 94). Vacio solo en obras publicadas antes de la 079.';

-- ── 3 · La entrega de cada venta ────────────────────────────────────────────
create table if not exists public.sale_deliveries (
  transfer_id uuid primary key references public.transfers (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  seller_id uuid not null references auth.users (id) on delete cascade,
  -- La clase de la obra en el momento de la venta, aunque luego cambie.
  work_kind text not null check (work_kind in ('physical', 'digital')),
  choice text not null check (choice in ('deliver', 'collect', 'none', 'digital')),
  -- Solo con 'deliver', y con el consentimiento de pasarla al vendedor.
  address jsonb,
  address_consent_at timestamptz,
  -- Lo que da el vendedor: transportista y guia, recogida confirmada, o como
  -- se envio una obra digital.
  details_kind text check (details_kind in ('carrier', 'collected', 'digital')),
  details jsonb,
  details_submitted_at timestamptz,
  -- Cuando el barrido abrio el caso por datos vencidos. Una vez por venta.
  overdue_opened_at timestamptz,
  created_at timestamptz not null default now(),
  check ((work_kind = 'digital') = (choice = 'digital')),
  check (choice <> 'deliver' or (address is not null and address_consent_at is not null)),
  check (choice = 'deliver' or (address is null and address_consent_at is null)),
  check ((details is null) = (details_submitted_at is null)),
  check ((details is null) = (details_kind is null))
);

create index if not exists sale_deliveries_seller_idx on public.sale_deliveries (seller_id) where details_submitted_at is null;
create index if not exists sale_deliveries_buyer_idx on public.sale_deliveries (buyer_id);

alter table public.sale_deliveries enable row level security;

drop policy if exists "sale deliveries readable by the two parties" on public.sale_deliveries;
create policy "sale deliveries readable by the two parties" on public.sale_deliveries
  for select using ((select auth.uid()) in (buyer_id, seller_id));

-- Sin politica de escritura la RLS ya lo niega; tambien se quita el permiso.
revoke insert, update, delete on public.sale_deliveries from anon, authenticated;
revoke select on public.sale_deliveries from anon;
grant select on public.sale_deliveries to authenticated;

-- ── 4 · La retencion ────────────────────────────────────────────────────────
alter table public.payout_earnings
  add column if not exists awaiting_delivery_details boolean not null default false;

comment on column public.payout_earnings.awaiting_delivery_details is
  'Ganancia de venta de plataforma con entrega pedida y sin datos de entrega todavia. No pasa a available mientras sea true (decision 94).';

-- Nace retenida. Solo una ganancia de VENTA: las regalias nunca se retienen por
-- esto, y en la via directa no hay ganancia de venta que retener.
create or replace function public.hold_sale_earning_for_delivery()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source = 'sale' and new.source_ref is not null and exists (
    select 1 from public.sale_deliveries d
     where d.transfer_id = new.source_ref
       and d.choice = 'deliver' and d.details_submitted_at is null
  ) then
    new.awaiting_delivery_details := true;
  end if;
  return new;
end;
$$;

drop trigger if exists payout_earnings_hold_for_delivery on public.payout_earnings;
create trigger payout_earnings_hold_for_delivery
  before insert on public.payout_earnings
  for each row execute function public.hold_sale_earning_for_delivery();

-- Y la base se niega a liberarla mientras espera, la libere quien la libere.
-- Solo el paso a available: cancelarla por un reembolso sigue pudiendo hacerse.
create or replace function public.refuse_release_awaiting_delivery()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.state = 'available' and old.state is distinct from 'available' and new.awaiting_delivery_details then
    raise exception 'payout_earnings %: waiting for delivery details', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists payout_earnings_refuse_release_awaiting on public.payout_earnings;
create trigger payout_earnings_refuse_release_awaiting
  before update of state on public.payout_earnings
  for each row execute function public.refuse_release_awaiting_delivery();

-- La funcion que libera desde la pantalla de Cobros (020) salta las retenidas:
-- sin esto, el trigger de arriba tumbaria la liberacion entera de quien llama.
create or replace function public.release_my_due_payout_earnings()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved int;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    return 0;
  end if;

  update public.payout_earnings
     set state = 'available',
         released_at = now(),
         hold_reason = null
   where user_id = caller
     and state = 'pending'
     and releases_at is not null
     and releases_at <= now()
     and not awaiting_delivery_details;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke all on function public.release_my_due_payout_earnings() from public, anon;
grant execute on function public.release_my_due_payout_earnings() to authenticated;

-- ── 5 · El reconocimiento, una vez por tipo ─────────────────────────────────
-- La misma tabla y el mismo versionado que el de los Terms (0.8b): una fila por
-- persona y tipo, con su version.
alter table public.terms_acceptances
  add column if not exists kind text not null default 'terms';

alter table public.terms_acceptances drop constraint if exists terms_acceptances_kind_check;
alter table public.terms_acceptances add constraint terms_acceptances_kind_check
  check (kind in ('terms', 'buyer_delivery', 'seller_delivery'));

create index if not exists terms_acceptances_user_kind_idx on public.terms_acceptances (user_id, kind);

-- ── Comprobacion ────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'sale_deliveries' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception '079: sale_deliveries acepta escrituras desde el cliente';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payout_earnings_refuse_release_awaiting') then
    raise exception '079: falta el trigger que impide liberar una ganancia retenida';
  end if;
end
$$;
