-- ============================================================================
-- 065 · Payout Methods — Work Order 02, Stage 7
-- ============================================================================
--
-- 7.1  No default destination (M24). The person chooses the method on every
--      collection; one destination is kept per method. The destination-change
--      notice (Work Order 01 Step 21) is unchanged.
--
-- 7.3  Platform-path proceeds are collected in the same blocks as royalties,
--      with the commission and the method cost from configuration — no longer
--      from the method row, so a fee has one home.
--
-- 7.5  An institution's earnings are reserved in a payouts ticket rather than
--      disbursed: 'reserved' joins the states.
-- ============================================================================

-- One destination per method: keep the newest of any duplicates.
delete from public.payout_destinations d
 using public.payout_destinations newer
 where d.user_id = newer.user_id
   and d.method_id = newer.method_id
   and (d.created_at, d.id) < (newer.created_at, newer.id);

drop index if exists public.payout_destinations_default_idx;
alter table public.payout_destinations drop column if exists is_default;
alter table public.payout_destinations
  drop constraint if exists payout_destinations_one_per_method,
  add constraint payout_destinations_one_per_method unique (user_id, method_id);

alter table public.payout_earnings
  drop constraint if exists payout_earnings_state_check,
  add constraint payout_earnings_state_check check (state in ('pending', 'available', 'collected', 'reserved'));

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
  c public.platform_config%rowtype;
begin
  select * into c from public.platform_config where id;
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

  -- Work Order 02, 7.3: la comision y el costo del rail salen de
  -- configuracion, la unica casa de esos numeros (Stage 1).
  v_platform_fee := round(v_gross * c.payout_platform_pct, 2);
  v_method_fee   := case v_method.provider
    when 'stripe_connect_bank' then c.payout_cost_bank
    when 'stripe_connect_stablecoin' then c.payout_cost_usdc
    else round(v_gross * v_method.method_pct + v_method.method_flat, 2)
  end;
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

-- Solo el service role, como antes: la ruta la llama despues de biometrico y
-- codigo privado.
revoke all on function public.create_payout_block(uuid, text, text, uuid[]) from public, anon, authenticated;
