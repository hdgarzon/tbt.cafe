-- ============================================================================
-- 025_payout_country_coverage.sql — Cobertura por pais, verificada
-- ============================================================================
-- Area 2 §6 la llamaba "the highest-priority open item" y pedia verificarla
-- ANTES de construir. La verificacion desmintio el supuesto del §2.2.
--
--   Banco  — "Platforms based in the United States, United Kingdom, EEA,
--            Canada, and Switzerland can transfer funds to connected accounts
--            located in any of these same regions."
--            docs.stripe.com/connect/cross-border-payouts  (21 ago 2026)
--
--   USDC   — lista explicita de paises admitidos. No incluye BR ni ES, y sigue
--            en preview privado, solo para plataformas de EE.UU.
--            docs.stripe.com/connect/stablecoin-payouts    (21 ago 2026)
--
-- `usdc` tenia countries = ['*'] y la resolucion hace includes('*') -> true: se
-- ofrecia a todo el mundo, incluidos Brasil y Espana, donde Stripe no puede
-- entregarlo. Prometer un cobro que no existe es peor que no ofrecerlo.
--
-- Brasil no tiene hoy ningun rail. Es un hecho del proveedor, no una omision.
-- ============================================================================

update public.payout_methods
   set countries = array[
     'AE','AM','AR','AT','AU','AZ','BE','BG','BH','BJ','CA','CH','CL','CO','CR',
     'CY','CZ','DK','DO','EC','EE','FI','FR','GH','GR','HR','HU','IE','IL','JM',
     'JO','KE','KR','KW','KZ','LI','LK','LT','LU','LV','MN','MT','MU','MX','MY',
     'NL','NO','NZ','PA','PE','PH','PL','PT','PY','RO','SA','SE','SG','SI','SK',
     'SV','TH','TN','US','UY','UZ','ZA'
   ], updated_at = now()
 where id = 'usdc';

update public.payout_methods
   set countries = array[
     'US','GB','CA','CH',
     'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
     'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
     'IS','LI','NO'
   ], updated_at = now()
 where id = 'bank';
