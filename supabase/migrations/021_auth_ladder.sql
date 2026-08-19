-- ============================================================================
-- 021_auth_ladder.sql — Escalera de autenticación por monto
-- ============================================================================
-- Backend Spec 01 §5.1, §5.2 y §5.4.
--
-- Dos umbrales, aplicables a compradores Y a vendedores:
--
--   por debajo de $500   solo scoring de Radar, sin fricción añadida
--   $500 y más           biométrico
--   $1.000 y más         biométrico + 3D Secure
--
-- Del lado del vendedor, aceptar una oferta e iniciar una transferencia
-- entran por el escalón de $500.
--
-- Lo que consigue cada factor es distinto y se confunde a menudo (§5.2):
--
--   3D Secure    traslada la responsabilidad del fraude al banco EMISOR. Es la
--                única medida de la lista que mueve responsabilidad, y por eso
--                existe el escalón de $1.000.
--   Biométrico   prueba a tbt.cafe que el dueño del dispositivo aprobó la
--                acción. El emisor no queda obligado por él: su valor es
--                prevenir secuestro de cuenta y servir de evidencia en
--                disputas (§5.4), no trasladar responsabilidad.
--
-- No destructiva.
-- ============================================================================


-- ── Los umbrales ───────────────────────────────────────────────────────────
-- Son política, no lógica: el Área 2 §5.2 los lista como configurables por
-- administración sin desplegar, junto a la tarifa de servicio y las ventanas
-- de liquidación.
alter table public.platform_config
  add column if not exists biometric_threshold numeric(12,2) not null default 500
    check (biometric_threshold >= 0),
  add column if not exists three_ds_threshold numeric(12,2) not null default 1000
    check (three_ds_threshold >= 0);

comment on column public.platform_config.three_ds_threshold is
  'Desde este monto se exige 3D Secure además del biométrico (Spec 01 §5.1). '
  'Coincide hoy con settlement_high_threshold en el valor, pero son reglas '
  'DISTINTAS: una decide fricción de autenticación y la otra cuánto se retiene '
  'un payout. Mover una no debe mover la otra.';


-- ── El registro de lo que se exigió y se cumplió ───────────────────────────
-- El §5.4 pide que la confirmación biométrica en la compra quede registrada
-- con marca de tiempo y sea exportable desde la herramienta de administración:
-- es una de las cinco piezas del paquete de evidencia de disputa.
--
-- Se guarda aunque no se exija nada. Una compra de $120 sin fricción también
-- es un hecho que la evidencia necesita: demuestra que la regla se aplicó y
-- cuál era el umbral vigente ese día, no el de hoy.
--
-- Alcance (§5.4): esto gana las disputas de "yo no autoricé esto". No hace
-- nada por las de "no era lo descrito", que son responsabilidad del vendedor
-- pase lo que pase.
create table if not exists public.money_action_auth (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  action text not null check (action in (
    'purchase',            -- comprador adquiere una obra
    'offer_accept',        -- vendedor acepta una oferta
    'transfer_initiate',   -- emisor inicia una transferencia
    'payout_collect',      -- cobro de un bloque
    'payout_destination'   -- cambio de destino
  )),
  amount numeric(12,2),
  work_id uuid references public.works(id) on delete set null,

  -- Qué exigía la escalera en ese momento.
  required_biometric boolean not null default false,
  required_three_ds boolean not null default false,
  required_private_code boolean not null default false,

  -- Qué se cumplió de verdad. Verificado en servidor, nunca afirmado por el
  -- cliente: el biométrico se apunta aquí al CONSUMIR la prueba.
  satisfied_biometric boolean not null default false,
  satisfied_private_code boolean not null default false,

  -- Los umbrales vigentes al decidir, congelados. Si mañana suben, este
  -- registro tiene que seguir explicando por qué aquel día no se pidió nada.
  biometric_threshold_at_time numeric(12,2),
  three_ds_threshold_at_time numeric(12,2),

  created_at timestamptz not null default now()
);

create index if not exists money_action_auth_user_idx
  on public.money_action_auth (user_id, created_at desc);

create index if not exists money_action_auth_work_idx
  on public.money_action_auth (work_id) where work_id is not null;

alter table public.money_action_auth enable row level security;

-- La persona ve lo suyo; el equipo lo exporta con el service role desde la
-- herramienta de administración. Nadie escribe desde el cliente: un registro
-- de evidencia que el propio interesado puede redactar no es evidencia.
drop policy if exists "own money action auth readable" on public.money_action_auth;
create policy "own money action auth readable" on public.money_action_auth
  for select using ((select auth.uid()) = user_id);


-- ── Resolución de la escalera, del lado del servidor ───────────────────────
-- El cliente calcula lo mismo para saber qué pedir, pero esta es la que manda.
-- Una comprobación que el cliente puede afirmar por su cuenta no es una
-- comprobación — la lección que ya dejó escrita la 018.
--
-- Devuelve también los umbrales usados, para que quien registre la acción
-- congele los de ese momento sin volver a leerlos.
create or replace function public.resolve_auth_ladder(
  p_action text,
  p_amount numeric
)
returns table (
  need_biometric boolean,
  need_three_ds boolean,
  need_private_code boolean,
  biometric_threshold numeric,
  three_ds_threshold numeric
)
language sql
stable
set search_path = ''
as $$
  select
    case
      -- Cobrar y cambiar destino exigen los dos factores SIEMPRE, sin umbral
      -- (§5.1). El dinero saliendo es el objetivo de mayor valor.
      when p_action in ('payout_collect', 'payout_destination') then true
      else coalesce(p_amount, 0) >= c.biometric_threshold
    end,
    case
      when p_action in ('payout_collect', 'payout_destination') then false
      else coalesce(p_amount, 0) >= c.three_ds_threshold
    end,
    p_action in ('payout_collect', 'payout_destination'),
    c.biometric_threshold,
    c.three_ds_threshold
  from public.platform_config c
  where c.id;
$$;
