-- La prueba biométrica dura lo que tarda una persona, no lo que tarda un script.
--
-- Dos minutos alcanzan para escribir un código a la primera. No alcanzan para
-- equivocarse y reintentar, que es lo que pasa de verdad: la prueba caducaba
-- entre intento e intento y la pantalla dejaba a la persona peleando contra algo
-- ya muerto, sin decírselo.
--
-- Sigue siendo de un solo uso, que es lo que importa para que no se reutilice.
alter table public.biometric_proofs
  alter column expires_at set default now() + interval '10 minutes';
