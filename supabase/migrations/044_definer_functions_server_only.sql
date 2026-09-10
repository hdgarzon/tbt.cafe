-- ============================================================================
-- 044_definer_functions_server_only.sql — Lo que solo llama el servidor
-- ============================================================================
-- Tercera vez que aparece la misma forma, despues de 042 y 043: una funcion
-- `security definer` que recibe a la persona por parametro y a la que nadie le
-- quito el EXECUTE.
--
-- Postgres concede EXECUTE a PUBLIC al crear una funcion, y Supabase se lo
-- concede ademas por nombre a `anon` y `authenticated`. `security definer` la
-- ejecuta con los permisos de su propietario, saltandose la RLS. Juntas, esas
-- tres cosas convierten cada una de estas funciones en un endpoint de PostgREST
-- que acepta la clave anonima, que es la que viaja en el navegador.
--
-- Comprobado contra la base viva, sin sesion, con un uuid y un hash inventados
-- para que ninguna llamada tocase una fila:
--
--   private_code_clear_failures(who)      204
--   consume_biometric_proof(who, hash)    200 false
--   notification_enabled(who, item)       200 true
--   provider_failure_summary(hours)       200
--
-- `private_code_register_failure` no se sondeo porque escribe; es de la misma
-- migracion y tampoco tenia revoke.
--
-- LO QUE PERMITIAN
--
--   private_code_clear_failures    poner a cero el contador de intentos del
--                                  codigo privado de CUALQUIER usuario. Ese
--                                  contador es lo que frena la fuerza bruta del
--                                  step-up: se podia probar un codigo, borrar el
--                                  fallo y volver a probar, sin fin.
--   private_code_register_failure  lo contrario: sumarle fallos a otra persona
--                                  hasta dejarle el step-up bloqueado.
--   consume_biometric_proof        gastar una prueba biometrica ajena. Hace
--                                  falta su hash, que no se adivina, pero no hay
--                                  razon para que se pueda intentar.
--   provider_failure_summary       leer el resumen de fallos de proveedores, que
--                                  es el panel de observabilidad, saltandose la
--                                  RLS de provider_events.
--   notification_enabled           saber que avisos tiene activos otra persona.
--
-- LA CORRECCION ES LA DE 020 Y 026
--
-- Todas las llama el servidor y nadie mas, siempre con el cliente de servicio:
-- la ruta de step-up, `two-factor.ts`, `auth-ladder-server.ts` —sus dos
-- llamantes le pasan `createAdminClient()`—, `notify.ts` y la ruta de
-- observabilidad. Asi que no hace falta cambiar ninguna firma: el parametro
-- `who` es legitimo cuando solo el servidor puede escribirlo. Basta con
-- quitarles el EXECUTE a public, anon y authenticated, que es exactamente lo que
-- 020 y 026 hicieron con los pagos. Comprobado en produccion que ese patron deja
-- al service role funcionando: `settle_payout_block` le responde a el y se lo
-- niega al anonimo.
--
-- `ticket_reply_reopens` no esta aqui a proposito: es una funcion de trigger, no
-- se puede invocar como RPC, y su EXECUTE se exige al crear el trigger, no al
-- dispararlo.
--
-- Se comprueba a si misma antes de confirmar: si al terminar `anon` o
-- `authenticated` pueden ejecutar alguna, o el service role no puede, lanza y la
-- transaccion entera se deshace.
--
-- `npm run check:grants` sostiene la regla para las que vengan.
-- ============================================================================

begin;

revoke all on function public.private_code_register_failure(uuid) from public, anon, authenticated;
revoke all on function public.private_code_clear_failures(uuid)   from public, anon, authenticated;
revoke all on function public.consume_biometric_proof(uuid, text) from public, anon, authenticated;
revoke all on function public.notification_enabled(uuid, text)    from public, anon, authenticated;
revoke all on function public.provider_failure_summary(integer)   from public, anon, authenticated;

grant execute on function public.private_code_register_failure(uuid) to service_role;
grant execute on function public.private_code_clear_failures(uuid)   to service_role;
grant execute on function public.consume_biometric_proof(uuid, text) to service_role;
grant execute on function public.notification_enabled(uuid, text)    to service_role;
grant execute on function public.provider_failure_summary(integer)   to service_role;

do $$
declare
  fn text;
  fns text[] := array[
    'public.private_code_register_failure(uuid)',
    'public.private_code_clear_failures(uuid)',
    'public.consume_biometric_proof(uuid, text)',
    'public.notification_enabled(uuid, text)',
    'public.provider_failure_summary(integer)'
  ];
begin
  foreach fn in array fns loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'anon todavia puede ejecutar %', fn;
    end if;
    if has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'authenticated todavia puede ejecutar %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'service_role ya no puede ejecutar %', fn;
    end if;
  end loop;
end;
$$;

commit;
