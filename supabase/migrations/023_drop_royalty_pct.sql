-- ============================================================================
-- 023_drop_royalty_pct.sql — Retirar work_commerce.royalty_pct
-- ============================================================================
-- La migración 008 añadió `royalty_pct numeric(5,2) not null default 10` como
-- una segunda forma de expresar una regalía, junto a los términos canónicos del
-- Spec 01 (`royalty_type` + `royalty_value`). Dos representaciones de lo mismo,
-- sin nada que las sincronizara.
--
-- No es teoría: la columna cobró dinero mal.
--
--   `transfer/create` resolvía por ella, y ella nunca se escribió — las 46 filas
--   conservaban su default. Así que toda transferencia se cotizaba al 10% fuera
--   cual fuera la obra: una regalía fija de $10 sobre un valor de $5.000 se
--   cobraba como $500, y seis obras con porcentajes entre 5 y 20 se cobraban al
--   10. Mientras tanto el libro de ganancias abonaba por los términos
--   canónicos, de modo que la plataforma autorizaba una cifra y debía otra.
--
-- Eso se arregló en el código (hdgarzon/tbt#34 y tbt.cafe#10). Esto retira la
-- columna para que no vuelva a pasar: mientras exista, alguien puede leerla.
--
-- DESTRUCTIVA, y deliberadamente segura de serlo. Antes de escribir esto se
-- comprobó, contra la base de producción:
--
--   datos          46 filas, un único valor distinto (10.00), cero filas
--                  distintas del default. No se pierde información porque nunca
--                  hubo ninguna.
--   dependencias   ninguna vista, función, política RLS, índice ni restricción
--                  la menciona.
--   código         cero referencias en los dos repos, con las dos ramas main
--                  desplegadas.
--
-- Lo único que puede romper es un despliegue viejo que siga en pie en su URL de
-- preview y todavía la seleccione. No hay tráfico de usuarios ahí.
-- ============================================================================

alter table public.work_commerce
  drop column if exists royalty_pct;

-- Deja dicho en el esquema cuáles son los términos, para que la próxima persona
-- no invente una tercera forma.
comment on column public.work_commerce.royalty_type is
  'Canónico (Spec 01, ítem 1): none | percentage | fixed. Resolver SIEMPRE por royaltyAmountOf; §2.1 prohíbe que una ruta calcule valor × pct por su cuenta.';
comment on column public.work_commerce.royalty_value is
  'Canónico (Spec 01, ítem 1): el porcentaje o el monto fijo, según royalty_type.';
