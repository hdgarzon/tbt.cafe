-- Observabilidad — Backend Spec 07 §2.7.
--
-- Hasta ahora los fallos de proveedor terminaban en console.error, que vive en
-- los registros de Vercel: sirve para depurar un caso concreto si sabes cuándo
-- pasó, y no sirve para ver un patrón. El spec pide errores agrupados con
-- frecuencia y primera/última aparición, y eso necesita una tabla.
--
-- Esto NO reemplaza a los tickets. Un fallo de los del Área 3 §1.2 sigue
-- abriendo su ticket: la observabilidad es donde el equipo ve el patrón, los
-- tickets son donde se sigue el impacto en una persona concreta. Ambos, no uno
-- u otro.

create table if not exists public.provider_events (
  id uuid primary key default gen_random_uuid(),

  -- 'stripe' | 'twilio' | 'solana' | 'gemini' | 'supabase' | 'sendgrid'…
  provider text not null,
  -- Qué se le pidió: 'create_checkout', 'send_mms', 'mint_nft', 'assistant_answer'…
  operation text not null,
  ok boolean not null,

  -- Para agrupar. Se guarda un código corto y estable, no el mensaje entero:
  -- los mensajes llevan identificadores dentro y cada uno sería su propio grupo.
  error_code text,
  error_detail jsonb,

  latency_ms integer,

  -- A qué se refería, cuando aplica.
  entity_type text,
  entity_id text,

  created_at timestamptz not null default now()
);

-- Agrupar por proveedor + operación + código, que es como se lee un patrón.
create index if not exists provider_events_group_idx
  on public.provider_events (provider, operation, error_code, created_at desc);
-- Lo que falló, primero.
create index if not exists provider_events_failures_idx
  on public.provider_events (created_at desc) where not ok;

alter table public.provider_events enable row level security;

-- Solo el equipo con la casilla de observabilidad. La escritura es del servidor.
drop policy if exists "observability readable by team" on public.provider_events;
create policy "observability readable by team" on public.provider_events
  for select using (public.admin_has('observability.view'));

/**
 * Resumen agrupado de fallos.
 *
 * Devuelve frecuencia y primera/última aparición por (proveedor, operación,
 * código), que es exactamente lo que pide §2.7 y lo que un console.error no
 * puede dar.
 */
create or replace function public.provider_failure_summary(window_hours int default 168)
returns table (
  provider text,
  operation text,
  error_code text,
  occurrences bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.provider,
         e.operation,
         coalesce(e.error_code, 'unknown') as error_code,
         count(*) as occurrences,
         min(e.created_at) as first_seen,
         max(e.created_at) as last_seen
    from public.provider_events e
   where not e.ok
     and e.created_at > now() - (window_hours || ' hours')::interval
   group by e.provider, e.operation, coalesce(e.error_code, 'unknown')
   order by count(*) desc, max(e.created_at) desc;
$$;
