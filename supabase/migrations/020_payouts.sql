-- ============================================================================
-- 020_payouts.sql — Payouts: registro de métodos, destinos, ganancias y bloques
-- ============================================================================
-- Backend Spec 02 completo, y Spec 01 §4 (ventana de liquidación) y §5.1
-- (escalera de autenticación).
--
-- Cuatro piezas, en orden de dependencia:
--
--   payout_methods       el registro. DATOS, no código (§3).
--   payout_destinations  a dónde va el dinero de cada persona.
--   payout_earnings      el libro de lo que se debe, con su estado de liquidación.
--   payout_blocks        el registro de liquidación PYT-BLK-XXXXXX (§4).
--
-- Un bloque de payout es un REGISTRO DE LIQUIDACIÓN y NO se escribe a la
-- cadena (§4, regla canónica 16). Brew y transferencias sí van on-chain;
-- esto no.
--
-- No destructiva: solo CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ============================================================================


-- ── El país que resuelve los métodos ───────────────────────────────────────
-- El spec resuelve por `seller.connect_account.country` (§3.3). Todavía no
-- existen cuentas de Connect, así que el país vive aquí y la resolución ya
-- funciona; cuando Connect entre, esta columna se alimenta desde la cuenta
-- en vez de escribirse a mano, y nada más cambia.
alter table public.profiles
  add column if not exists payout_country text;   -- ISO 3166-1 alfa-2

comment on column public.profiles.payout_country is
  'País que resuelve los métodos de payout disponibles (Spec 02 §3.3). Sustituto '
  'de connect_account.country hasta que exista la cuenta de Connect.';


-- ── 1. El registro de métodos ──────────────────────────────────────────────
-- El requisito arquitectónico central del Área 2: los métodos son DATOS.
-- El backend resuelve qué hay disponible para el país del vendedor y la UI
-- pinta lo que reciba. Sin esto, cada país nuevo es un despliegue; con esto,
-- añadir Pix es una fila y un validador.
create table if not exists public.payout_methods (
  -- Identificador estable: 'usdc', 'bank', y más adelante 'pix', 'nequi'…
  id text primary key,
  -- Clave i18n, no texto: se pinta en los cuatro idiomas de lanzamiento.
  display_name_key text not null,
  enabled boolean not null default true,
  -- Países donde se ofrece. '*' como único elemento significa global.
  countries text[] not null default array['*'],
  provider text not null check (provider in (
    'stripe_connect_stablecoin',
    'stripe_connect_bank',
    'other'
  )),

  -- Cómo se captura y valida el destino (§3.2).
  dest_field_type text not null check (dest_field_type in (
    'wallet_address', 'bank_account', 'pix_key', 'phone', 'email'
  )),
  dest_network text,              -- para wallets: 'solana', 'ethereum', 'base'…
  dest_validation text,           -- regex o nombre de validador
  -- Las direcciones de wallet se re-escriben para confirmar. Un dígito mal en
  -- una dirección es dinero perdido sin vuelta atrás.
  dest_requires_confirm boolean not null default false,
  dest_label_key text not null,

  -- Comisiones. `platform_pct` por defecto 2.3% (§5), configurable sin
  -- despliegue porque es política, no lógica (§5.2).
  platform_pct numeric(6,4) not null default 0.0230,
  method_pct numeric(6,4) not null default 0,
  method_flat numeric(12,2) not null default 0,

  min_amount numeric(12,2),
  max_amount numeric(12,2),
  settlement_estimate_key text not null,
  sort_order int not null default 0,

  updated_at timestamptz not null default now()
);

alter table public.payout_methods enable row level security;

-- Lectura abierta: la pantalla de cobro necesita saber qué hay disponible
-- antes de que el usuario elija nada. Escritura solo del service role — un
-- método editable desde el cliente es dinero redirigible.
drop policy if exists "payout methods readable" on public.payout_methods;
create policy "payout methods readable" on public.payout_methods
  for select using (true);

-- Configuración de lanzamiento (§3.4). `bank` arranca DESHABILITADO a
-- propósito: la cobertura de Connect por país es el punto abierto de mayor
-- prioridad del handoff (§6, y el índice lo marca como #1) y todavía no está
-- verificada contra la documentación viva de Stripe. Habilitarlo antes de
-- verificar ofrece un método que puede fallar en el país del vendedor.
insert into public.payout_methods (
  id, display_name_key, enabled, countries, provider,
  dest_field_type, dest_network, dest_requires_confirm, dest_label_key,
  settlement_estimate_key, sort_order
) values (
  'usdc', 'payouts.method.usdc', true, array['*'], 'stripe_connect_stablecoin',
  'wallet_address', 'solana', true, 'payouts.dest.walletAddress',
  'payouts.eta.minutes', 10
) on conflict (id) do nothing;

insert into public.payout_methods (
  id, display_name_key, enabled, countries, provider,
  dest_field_type, dest_requires_confirm, dest_label_key,
  method_flat, settlement_estimate_key, sort_order
) values (
  'bank', 'payouts.method.bank', false, array[]::text[], 'stripe_connect_bank',
  'bank_account', false, 'payouts.dest.bankAccount',
  1.50, 'payouts.eta.days', 20
) on conflict (id) do nothing;


-- ── 2. Destinos guardados ──────────────────────────────────────────────────
-- Cambiar un destino exige biométrico + código privado, SIN umbral y sin
-- excepción (Spec 01 §5.1). El código privado es el único factor que un
-- teléfono robado y desbloqueado no puede aportar, y por eso guarda esto.
create table if not exists public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  method_id text not null references public.payout_methods(id),

  -- El valor completo, para poder disponer el pago.
  destination text not null,
  -- Lo que se muestra: nunca la dirección entera en pantalla.
  destination_masked text not null,
  network text,

  is_default boolean not null default false,
  -- La prueba de que el cambio pasó por biométrico + código privado. Sin ella
  -- la fila no debería existir; el service role la escribe al verificar.
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payout_destinations_user_idx
  on public.payout_destinations (user_id);

-- Postgres no indexa las claves foráneas por su cuenta. Sin este índice, tocar
-- una fila de payout_methods obliga a recorrer la tabla entera de destinos.
create index if not exists payout_destinations_method_idx
  on public.payout_destinations (method_id);

-- Un solo destino por defecto por persona.
create unique index if not exists payout_destinations_default_idx
  on public.payout_destinations (user_id) where is_default;

alter table public.payout_destinations enable row level security;

-- La persona ve los suyos. NO escribe: el alta y el cambio pasan por la ruta
-- del servidor que verifica biométrico + código privado antes de insertar.
drop policy if exists "own destinations readable" on public.payout_destinations;
create policy "own destinations readable" on public.payout_destinations
  for select using ((select auth.uid()) = user_id);


-- ── 3. Los bloques de liquidación ──────────────────────────────────────────
-- PYT-BLK-XXXXXX. Se crea al confirmar el cobro y agrupa las ganancias que
-- se disponen juntas. NO es una escritura a la cadena.
create table if not exists public.payout_blocks (
  id uuid primary key default gen_random_uuid(),
  block_id text not null unique,          -- PYT-BLK-7F3A92
  user_id uuid not null references auth.users(id) on delete cascade,
  method_id text not null references public.payout_methods(id),
  destination_masked text not null,

  -- El desglose que se le mostró a la persona al confirmar, congelado. Si
  -- mañana cambia el 2.3%, este bloque tiene que seguir explicando el número
  -- que se pagó, no el que se pagaría hoy.
  gross numeric(12,2) not null,
  platform_fee numeric(12,2) not null,
  method_fee numeric(12,2) not null,
  net numeric(12,2) not null,

  status text not null default 'processing' check (status in (
    'processing',   -- creado, disposición en curso
    'paid',         -- confirmado por el proveedor
    'failed'        -- rechazado o devuelto; las ganancias vuelven a available
  )),
  provider_reference text,
  failure_reason text,

  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists payout_blocks_user_idx
  on public.payout_blocks (user_id, created_at desc);

create index if not exists payout_blocks_method_idx
  on public.payout_blocks (method_id);

alter table public.payout_blocks enable row level security;

drop policy if exists "own blocks readable" on public.payout_blocks;
create policy "own blocks readable" on public.payout_blocks
  for select using ((select auth.uid()) = user_id);

-- Identificador legible del bloque. Seis hex en mayúscula: suficiente para
-- que soporte y la persona hablen del mismo bloque sin leer un UUID.
create or replace function public.new_payout_block_id()
returns text
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    -- md5/random/substr son de pg_catalog, así que resuelven con el
    -- search_path vacío. gen_random_bytes NO serviría: pgcrypto vive en el
    -- esquema `extensions` y habría que calificarlo.
    -- No hace falta que sea criptográfico: es una referencia legible para que
    -- soporte y la persona hablen del mismo bloque, no un secreto.
    candidate := 'PYT-BLK-' || upper(substr(
      md5(random()::text || clock_timestamp()::text), 1, 6
    ));
    exit when not exists (
      select 1 from public.payout_blocks where block_id = candidate
    );
  end loop;
  return candidate;
end;
$$;


-- ── 4. El libro de ganancias ───────────────────────────────────────────────
-- Cada monto que se le debe a alguien, con su estado de liquidación.
--
-- Existe como tabla y no como cálculo sobre `transfers`/`ownership_history`
-- por una razón concreta: `collected` hay que persistirlo. Una ganancia ya
-- cobrada tiene que dejar de estar disponible, y eso no se deriva de la venta
-- que la originó.
create table if not exists public.payout_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  source text not null check (source in ('sale', 'royalty', 'transfer', 'offer')),
  work_id uuid references public.works(id) on delete set null,
  -- La fila que la originó (transfers.id / ownership_history.id), para poder
  -- reconciliar y para no duplicar.
  source_ref uuid,

  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD',

  -- pending → available → collected (Spec 01 §4.1). Nunca se salta a
  -- collected: un payout jamás es cobrable de inmediato.
  state text not null default 'pending' check (state in ('pending', 'available', 'collected')),

  -- Cuándo pasa a available. Para ventas es un TEMPORIZADOR — 7 días hasta
  -- $1.000, 14 por encima (§4.2). Para transferencias y ofertas es null,
  -- porque liberan por EVENTO (aceptación de la contraparte), no por reloj.
  releases_at timestamptz,
  -- Por qué está retenida, para poder decírselo a la persona (§4.4).
  hold_reason text check (hold_reason in ('settlement_window', 'awaiting_counterparty')),

  payout_block_id uuid references public.payout_blocks(id) on delete set null,

  created_at timestamptz not null default now(),
  released_at timestamptz,
  collected_at timestamptz
);

create index if not exists payout_earnings_user_idx
  on public.payout_earnings (user_id, state);

-- Una venta no puede generar la misma ganancia dos veces. El webhook de
-- Stripe reintenta, y sin esto cada reintento sería dinero nuevo.
create unique index if not exists payout_earnings_source_idx
  on public.payout_earnings (source, source_ref)
  where source_ref is not null;

create index if not exists payout_earnings_release_idx
  on public.payout_earnings (releases_at) where state = 'pending';

-- Las dos foráneas restantes. `payout_block_id` no es opcional de indexar:
-- "qué ganancias entraron en este bloque" es la consulta del recibo de cobro.
create index if not exists payout_earnings_block_idx
  on public.payout_earnings (payout_block_id) where payout_block_id is not null;

create index if not exists payout_earnings_work_idx
  on public.payout_earnings (work_id) where work_id is not null;

alter table public.payout_earnings enable row level security;

-- Solo lectura para la persona. Toda escritura es del service role: si el
-- cliente pudiera insertar filas aquí, se estaría pagando a sí mismo.
drop policy if exists "own earnings readable" on public.payout_earnings;
create policy "own earnings readable" on public.payout_earnings
  for select using ((select auth.uid()) = user_id);


-- ── La ventana de liquidación ──────────────────────────────────────────────
-- Los dos plazos y el umbral son política y viven en platform_config, que ya
-- existe desde la 011 y que el Área 7 edita sin despliegue (§5.2).
alter table public.platform_config
  add column if not exists settlement_days_standard int not null default 7
    check (settlement_days_standard >= 0),
  add column if not exists settlement_days_high int not null default 14
    check (settlement_days_high >= 0),
  add column if not exists settlement_high_threshold numeric(12,2) not null default 1000
    check (settlement_high_threshold >= 0),
  add column if not exists payout_platform_pct numeric(6,4) not null default 0.0230
    check (payout_platform_pct >= 0);

comment on column public.platform_config.settlement_high_threshold is
  'Por encima de este monto la venta usa la ventana larga (Spec 01 §4.2). '
  'Es el mismo $1.000 del escalón de 3D Secure (§5.1), pero son reglas distintas: '
  'cambiar una no debe cambiar la otra.';

-- Calcula cuándo libera una ganancia. Se aplica SOLO a ventas y regalías:
-- transferencias y ofertas liberan por evento y devuelven null.
create or replace function public.payout_release_at(
  p_source text,
  p_sale_amount numeric,
  p_completed_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_source in ('transfer', 'offer') then null
    else p_completed_at + make_interval(days => (
      select case
        when p_sale_amount > c.settlement_high_threshold then c.settlement_days_high
        else c.settlement_days_standard
      end
      from public.platform_config c
      where c.id
    ))
  end;
$$;

-- Promueve a `available` lo que ya cumplió su ventana, SOLO de quien llama.
--
-- La pantalla de Payouts la invoca al abrir, para que nadie vea "pendiente" un
-- dinero cuyo plazo ya venció mientras espera al siguiente barrido del cron.
--
-- Va acotada al llamante a propósito. Es `security definer` porque tiene que
-- escribir en una tabla donde el cliente no tiene permiso de escritura, y una
-- versión global habría dejado que cualquier autenticado disparara un cambio
-- de estado sobre las filas de todos. El barrido global es del cron, con el
-- service role, que no pasa por aquí.
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
     and releases_at <= now();

  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke all on function public.release_my_due_payout_earnings() from public, anon;
grant execute on function public.release_my_due_payout_earnings() to authenticated;


-- ── El cobro, en una sola sentencia ────────────────────────────────────────
-- Crear el bloque y marcar las ganancias como cobradas tiene que ser atómico.
-- Separado en dos pasos, una caída entre ellos deja o bien ganancias cobradas
-- sin bloque que las explique, o bien un bloque pagado cuyas ganancias siguen
-- disponibles — es decir, cobrables por segunda vez.
--
-- El monto NO viene del cliente. Se suma aquí, sobre las filas bloqueadas y ya
-- verificadas como propias y disponibles. Lo que el cliente manda es qué
-- ganancias quiere cobrar; cuánto suman lo decide la base.
--
-- `for update` bloquea las filas: dos pestañas pulsando Cobrar a la vez no
-- pueden llevarse la misma ganancia dos veces.
create or replace function public.create_payout_block(
  p_user_id uuid,
  p_method_id text,
  p_destination_masked text,
  p_earning_ids uuid[]
)
returns table (block_id text, gross numeric, platform_fee numeric, method_fee numeric, net numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- El usuario llega por parámetro y NO de auth.uid(). La función está
  -- revocada para `authenticated`: la ejecuta el service role desde
  -- /api/payouts/collect, que es quien acaba de verificar biométrico + código
  -- privado. Derivarlo de auth.uid() habría obligado a conceder ejecución al
  -- cliente, y entonces un POST directo se saltaría los dos factores.
  caller uuid := p_user_id;
  v_gross numeric(12,2);
  v_count int;
  v_method public.payout_methods%rowtype;
  v_platform_fee numeric(12,2);
  v_method_fee numeric(12,2);
  v_net numeric(12,2);
  v_block_id text;
  v_block_uuid uuid;
begin
  if caller is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_method
    from public.payout_methods
   where id = p_method_id and enabled;
  if not found then
    raise exception 'method_unavailable';
  end if;

  -- Bloquear PRIMERO y sumar después, en dos sentencias: Postgres no admite
  -- `for update` junto a un agregado.
  perform 1
     from public.payout_earnings
    where id = any(p_earning_ids)
      and user_id = caller
      and state = 'available'
      for update;

  -- Solo ganancias propias y en `available`. Una `pending` colada en la lista
  -- no se cobra: se descarta al no cumplir el filtro, y el conteo lo delata.
  select coalesce(sum(amount), 0), count(*)
    into v_gross, v_count
    from public.payout_earnings
   where id = any(p_earning_ids)
     and user_id = caller
     and state = 'available';

  if v_count = 0 or v_count <> array_length(p_earning_ids, 1) then
    raise exception 'earnings_unavailable';
  end if;

  if v_method.min_amount is not null and v_gross < v_method.min_amount then
    raise exception 'below_minimum';
  end if;
  if v_method.max_amount is not null and v_gross > v_method.max_amount then
    raise exception 'above_maximum';
  end if;

  -- Las mismas fórmulas del §5, con las tasas de la fila del método.
  v_platform_fee := round(v_gross * v_method.platform_pct, 2);
  v_method_fee   := round(v_gross * v_method.method_pct + v_method.method_flat, 2);
  v_net          := v_gross - v_platform_fee - v_method_fee;

  if v_net <= 0 then
    raise exception 'net_not_positive';
  end if;

  v_block_id := public.new_payout_block_id();

  insert into public.payout_blocks (
    block_id, user_id, method_id, destination_masked,
    gross, platform_fee, method_fee, net, status
  ) values (
    v_block_id, caller, p_method_id, p_destination_masked,
    v_gross, v_platform_fee, v_method_fee, v_net, 'processing'
  ) returning id into v_block_uuid;

  update public.payout_earnings
     set state = 'collected',
         collected_at = now(),
         payout_block_id = v_block_uuid
   where id = any(p_earning_ids)
     and user_id = caller
     and state = 'available';

  return query select v_block_id, v_gross, v_platform_fee, v_method_fee, v_net;
end;
$$;

-- Solo el service role. La ruta del servidor la llama DESPUÉS de verificar
-- biométrico + código privado (Spec 01 §5.1); si `authenticated` pudiera
-- ejecutarla, un POST directo se saltaría los dos factores.
revoke all on function public.create_payout_block(uuid, text, text, uuid[]) from public, anon, authenticated;
