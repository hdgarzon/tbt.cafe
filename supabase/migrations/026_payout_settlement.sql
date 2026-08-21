-- ============================================================================
-- 026_payout_settlement.sql — Cerrar un bloque de payout: pagado o fallido
-- ============================================================================
-- `create_payout_block` mueve las ganancias de 'available' a 'collected' y deja
-- el bloque en 'processing'. Hasta ahora nada lo movia de ahi. El comentario de
-- la 020 promete que al fallar "las ganancias vuelven a available" — esa vuelta
-- atras no existia, asi que un fallo dejaba el dinero de alguien atrapado en un
-- estado del que no se sale.
--
-- POR QUE DOS FUNCIONES Y NO UN UPDATE
--
-- Igual que `create_payout_block`, estas toman el bloque explicitamente y estan
-- revocadas de `authenticated`. Marcar un pago como hecho es afirmar que el
-- dinero salio: no lo decide el cliente, lo decide el servidor despues de que
-- el proveedor lo confirme.
--
-- Ambas son idempotentes por el `where status = 'processing'`. Un reintento del
-- webhook no vuelve a mover ganancias ni pisa una fecha de liquidacion.
--
-- No destructiva.
-- ============================================================================

create or replace function public.settle_payout_block(
  p_block_id text,
  p_reference text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_rows integer;
begin
  update public.payout_blocks
     set status = 'paid',
         provider_reference = p_reference,
         settled_at = now()
   where block_id = p_block_id
     and status = 'processing';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.fail_payout_block(
  p_block_id text,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uuid uuid;
  v_rows integer;
begin
  update public.payout_blocks
     set status = 'failed',
         failure_reason = p_reason
   where block_id = p_block_id
     and status = 'processing'
  returning id into v_uuid;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  -- El dinero vuelve a estar disponible. `released_at` se conserva: la ventana
  -- de liquidacion ya se cumplio y no se vuelve a cumplir por un fallo del
  -- rail. Volver a 'pending' castigaria a la persona por un problema nuestro.
  update public.payout_earnings
     set state = 'available',
         collected_at = null,
         payout_block_id = null
   where payout_block_id = v_uuid;

  return true;
end;
$$;

revoke all on function public.settle_payout_block(text, text) from public, anon, authenticated;
revoke all on function public.fail_payout_block(text, text)   from public, anon, authenticated;

comment on function public.settle_payout_block(text, text) is
  'Cierra un bloque como pagado. Solo service role: afirmar que el dinero salio no lo decide el cliente.';
comment on function public.fail_payout_block(text, text) is
  'Cierra un bloque como fallido y devuelve sus ganancias a available, conservando released_at.';
