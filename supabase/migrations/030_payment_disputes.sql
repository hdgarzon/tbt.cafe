-- ============================================================================
-- 030_payment_disputes.sql — Que un contracargo deje rastro
-- ============================================================================
-- El webhook atendia dos eventos: la sesion completada y la caducada. Todo lo
-- demas caia en un `default` que solo escribe en el log. Asi que una disputa
-- llegaba, Stripe sacaba el importe del saldo de la plataforma mas su comision
-- —la gane o la pierda—, y el sistema seguia igual: la obra transferida, la
-- regalia acreditada, y el unico aviso un correo a la bandeja de alguien.
--
-- La plataforma es el comercio de registro de todos los cargos, asi que cada
-- una de esas perdidas es suya. Esta tabla es el minimo para que dejen de ser
-- invisibles.
--
-- LA CLAVE ES LA DE STRIPE, Y ESO ES LA PROTECCION DE REENVIO
--
-- Esta ruta no tiene ninguna: no hay tabla de eventos procesados, ni indice
-- unico, ni una sola lectura de `event.id` en todo el repositorio. Usar la
-- referencia de Stripe como clave primaria hace que un reenvio choque en vez
-- de duplicar, y que `charge.dispute.closed` actualice la fila que abrio
-- `charge.dispute.created` en lugar de crear una segunda. Un reembolso parcial
-- seguido de otro se comporta igual, porque su referencia es la del cargo.
--
-- LO QUE SE RESUELVE Y LO QUE NO
--
-- Llegar de un `pi_…` a una obra exige sondear tres columnas en dos tablas, y
-- hay pagos para los que no lleva a ninguna parte: un registro reconciliado
-- sin webhook deja `stripe_payment_intent_id` en NULL. Por eso `work_id`,
-- `transfer_id` y `subject_user` son opcionales y `raw` no lo es. Perder la
-- disputa por no saber a que apunta seria repetir el silencio que esto viene a
-- romper; con el evento entero se reconstruye a mano.
--
-- LO QUE ESTA TABLA NO HACE
--
-- No congela ganancias ni revierte nada. El libro de `payout_earnings` no sabe
-- congelar —no hay estado para ello, `amount > 0` prohibe una fila negativa, y
-- el indice unico sobre (source, source_ref) impide una compensatoria—, y
-- quitarle la regalia a un creador porque un comprador disputo es una decision
-- de negocio, no un efecto secundario de escuchar un webhook.
--
-- No destructiva.
-- ============================================================================

create table if not exists public.payment_disputes (
  -- `dp_…` en una disputa, `ch_…` en un reembolso.
  provider_ref text primary key,

  kind text not null check (kind in ('dispute', 'refund')),

  charge_id text,
  payment_intent_id text,

  -- Lo que se pudo resolver. NULL no es un fallo del webhook.
  work_id uuid references public.works(id) on delete set null,
  transfer_id uuid references public.transfers(id) on delete set null,
  subject_user uuid references auth.users(id) on delete set null,

  -- Tal como lo llama Stripe: needs_response, won, lost, refunded…
  status text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  reason text,

  -- El evento entero. Cuando la resolucion no llega a nada, es lo unico que
  -- queda para reconstruirla.
  raw jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_disputes_work_idx
  on public.payment_disputes (work_id) where work_id is not null;

create index if not exists payment_disputes_user_idx
  on public.payment_disputes (subject_user) where subject_user is not null;

create index if not exists payment_disputes_unresolved_idx
  on public.payment_disputes (created_at desc) where work_id is null;

alter table public.payment_disputes enable row level security;

-- Sin politicas a proposito: solo el service role entra. Una disputa nombra a
-- la persona que pago y el motivo que alego; no es de nadie mas, y el vendedor
-- no puede hacer nada con ella que no pase antes por quien lleva el negocio.

-- ── La busqueda inversa ─────────────────────────────────────────────────────
-- Ninguna de las columnas por las que hay que buscar estaba indexada, porque
-- hasta ahora nadie buscaba por ellas: se escriben una vez y se leen por la
-- clave de la fila. Una disputa entra por el otro lado.

create index if not exists tbt_payments_payment_intent_idx
  on public.tbt_payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create index if not exists transfers_payment_intent_idx
  on public.transfers (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create index if not exists transfers_payment_reference_idx
  on public.transfers (payment_reference) where payment_reference is not null;

create index if not exists works_payment_intent_idx
  on public.works (payment_intent_id) where payment_intent_id is not null;

comment on table public.payment_disputes is
  'Contracargos y reembolsos de Stripe. La clave es la referencia de Stripe: es la unica proteccion de reenvio que tiene el webhook.';
