-- ============================================================================
-- 024_connect_accounts.sql — La cuenta de Stripe Connect de cada vendedor
-- ============================================================================
-- Hasta ahora un bloque de payout nacia en 'processing' y se quedaba ahi para
-- siempre: el libro contable estaba entero —regalias, ventana de liquidacion,
-- comisiones, escalera de autenticacion— pero no habia rail. El dinero no
-- salia. Esta tabla es la primera mitad de esa ultima milla.
--
-- POR QUE UNA CUENTA CONECTADA
--
-- Spec 01 §3.2: los fondos se quedan en custodia de Stripe y no en los libros
-- de tbt.cafe, lo que reduce materialmente la exposicion a transmision de
-- dinero. El vendedor cobra desde su propio saldo en Stripe.
--
-- LA FORMA, VERIFICADA CONTRA LA API ACTUAL
--
-- Stripe indica que una integracion nueva use Accounts v2, no v1. La cuenta se
-- crea con `configuration.recipient` —el vendedor recibe dinero, no cobra
-- cargos— y `dashboard: 'express'`.
--
-- Express no es una preferencia estetica: el pago en USDC exige que la persona
-- tenga Express Dashboard, y USDC es el UNICO rail que alcanza Latinoamerica,
-- porque los payouts bancarios de Connect solo llegan a EE.UU., Reino Unido,
-- EEE, Canada y Suiza. La geografia del producto elige el dashboard.
--
-- Y Express obliga lo demas: la API rechaza `dashboard: 'express'` si el
-- responsable de perdidas no es la plataforma. Asumirlo es el precio de llegar
-- a los vendedores; el riesgo es acotado porque solo se transfieren regalias ya
-- cobradas, nunca adelantos.
--
-- No destructiva.
-- ============================================================================

create table if not exists public.payout_connect_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- acct_... — el identificador de Stripe. Unico: una cuenta por persona.
  account_id text not null unique,
  -- El pais decide que rails existen, y es inmutable en Stripe tras activarse.
  country text not null,

  status text not null default 'onboarding' check (status in (
    'onboarding',   -- creada, faltan requisitos por completar
    'active',       -- puede recibir transferencias
    'restricted',   -- Stripe pidio algo mas; no se puede disponer
    'rejected'      -- Stripe la rechazo
  )),

  -- La verdad operativa: sin esto en true, una transferencia falla. Se refresca
  -- desde el webhook, no se deduce.
  transfers_enabled boolean not null default false,
  requirements_due text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_connect_accounts_account_idx
  on public.payout_connect_accounts (account_id);

alter table public.payout_connect_accounts enable row level security;

-- Cada quien ve la suya, para que la interfaz sepa si ya puede cobrar.
drop policy if exists "own connect account readable" on public.payout_connect_accounts;
create policy "own connect account readable" on public.payout_connect_accounts
  for select using ((select auth.uid()) = user_id);

-- La escritura es del service role. Crear o promover una cuenta de cobro es
-- disponer del dinero de alguien: no lo decide el cliente.
