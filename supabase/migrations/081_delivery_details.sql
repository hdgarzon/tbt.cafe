-- ============================================================================
-- 081_delivery_details.sql — Quien vende da los datos de entrega
-- ============================================================================
-- Work Order 02, Amendment Delivery 01 (decision 94), Stage 7.
--
-- Despues de una venta con entrega pedida, quien vende da los datos:
-- transportista y guia con "entregamelo", la recogida confirmada con "lo
-- recojo", o como se envio una obra digital. En la via de plataforma eso suelta
-- la retencion que la 079 puso sobre la ganancia de la venta; despues aplica la
-- ventana de liquidacion como siempre.
--
-- UNA TRANSACCION. Guardar los datos y soltar la retencion van juntos: si
-- quedaran separados, un fallo entre los dos dejaria a quien vende con sus
-- datos dados y su dinero retenido, sin forma de reintentar.
--
-- EL TIPO SALE DE LA ELECCION. Lo que se guarda depende de lo que eligio el
-- comprador, no de lo que mande el navegador.
--
-- No es security definer: la llama el servidor con el service role, y nadie
-- mas puede llamarla.
--
-- Numerada 081: la 080 es la de #178. Si cambian, se renumera.
--
-- No destructiva.
-- ============================================================================

create or replace function public.submit_delivery_details(p_transfer uuid, p_seller uuid, p_details jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_row public.sale_deliveries%rowtype;
  v_kind text;
  v_submitted boolean := false;
  v_released int := 0;
begin
  select * into v_row from public.sale_deliveries where transfer_id = p_transfer for update;
  if not found then
    raise exception 'not_found';
  end if;

  if v_row.seller_id is distinct from p_seller then
    raise exception 'not_seller';
  end if;

  if not exists (select 1 from public.transfers where id = p_transfer and payment_status = 'completed') then
    raise exception 'sale_not_completed';
  end if;

  if v_row.choice = 'none' then
    raise exception 'no_details_needed';
  end if;

  v_kind := case v_row.choice
    when 'deliver' then 'carrier'
    when 'collect' then 'collected'
    when 'digital' then 'digital'
  end;

  -- Una segunda vez no reescribe lo que ya consta: los datos con su hora son
  -- evidencia en una disputa.
  if v_row.details_submitted_at is null then
    update public.sale_deliveries
       set details_kind = v_kind,
           details = coalesce(p_details, '{}'::jsonb),
           details_submitted_at = now()
     where transfer_id = p_transfer;
    v_submitted := true;
  end if;

  -- Y la retencion se suelta, tambien en un reintento: si una vez quedo puesta
  -- por lo que fuera, darla de nuevo la quita.
  update public.payout_earnings
     set awaiting_delivery_details = false
   where source = 'sale' and source_ref = p_transfer and awaiting_delivery_details;
  get diagnostics v_released = row_count;

  return jsonb_build_object('submitted', v_submitted, 'released', v_released);
end;
$$;

revoke all on function public.submit_delivery_details(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_delivery_details(uuid, uuid, jsonb) to service_role;
