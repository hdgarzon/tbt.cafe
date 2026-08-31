-- ============================================================================
-- 031_drop_dead_schema.sql — Quitar lo que nadie escribe ni lee
-- ============================================================================
-- DESTRUCTIVA. Borra columnas y tablas con sus datos.
--
-- Se aplica porque el dueño confirmo que todo lo que hay hoy en la base es de
-- prueba. Con datos reales, cada una de estas lineas exigiria su propia
-- conversacion.
--
-- Cada candidato se verifico DOS VECES contra la base viva: cuantas filas
-- tienen valor, y si alguna linea de `src/` la lee o la escribe. Los conteos
-- de abajo son reales, no estimaciones de `pg_stat`.
--
-- ── COLUMNAS GEMELAS ────────────────────────────────────────────────────────
--
-- `works` llevaba 55 columnas y varias eran la mitad muerta de un par. Escribir
-- en la mitad equivocada era silencioso: la fila se guarda y el valor no se lee
-- jamas. Ya causo un diagnostico falso —se consulto `nft_mint_address`, salio
-- nula, y se dio por fallido un minteo que habia funcionado.
--
--   viva                      muerta                     filas con valor
--   mint_address (32)         nft_mint_address           0 de 59
--   token_uri (32)            nft_token_uri              0 de 59
--   —                         nft_explorer_url           0 de 59
--   —                         blockchain_hash            0 de 59
--   —                         ipfs_hash                  0 de 59
--
-- El panel de admin leia tres de esas gemelas, y por eso "Open in explorer" no
-- aparecia nunca. Se corrigio en el mismo cambio; sin eso, este borrado habria
-- roto la ruta.
--
-- ── EL CODIGO DE TRANSFERENCIA EN CLARO ─────────────────────────────────────
--
-- `works.transfer_code` (40 de 59) y `transfers.transfer_code` (4 de 4) son
-- anteriores al hash. El codigo es un secreto al portador: quien lo tiene
-- reclama la obra, y por eso desde #28 solo se guarda `transfer_code_hash`.
-- Nada en el codigo lee ni escribe la version en claro.
--
-- ── TABLAS SIN ESCRITOR ─────────────────────────────────────────────────────
--
--   email_deliveries   0 filas. De la epoca de SendGrid, que nunca se uso;
--                      `provider_events` la reemplazo.
--   work_context       2 filas. Borrador anterior de `context_snapshots`, que
--                      tiene 49 y es la viva.
--   alerts             0 filas. La reemplazo `notifications`; la pestana de la
--                      interfaz llamada "alerts" lee de aquella.
--   work_views         0 filas. El contador de vistas nunca se construyo.
--   plagiarism_checks  0 filas. La migracion 003 ya la dio por obsoleta en
--                      favor de `plagiarism_scans` y aplazo el borrado.
--
-- ── LO QUE NO SE BORRA, Y POR QUE ───────────────────────────────────────────
--
--   plagiarism_scans   Tampoco tiene escritor, pero NO es un resto: la
--                      migracion 003 la designo canonica. Borrarla no seria
--                      limpiar sino deshacer una decision de diseno. Se queda,
--                      esperando a que el flujo de certificacion guarde el
--                      resultado que hoy las rutas de tbt-image descartan.
--
--   creator_type,      Tipos enumerados que ya estaban huerfanos ANTES de este
--   tbt_status         cambio, y que TypeScript refleja por su cuenta. No los
--                      dejo huerfanos esta migracion, asi que no le tocan.
--
--   works.token_uri    Viva: 32 filas. Es `nft_token_uri` la que se cae.
-- ============================================================================

-- ── Columnas gemelas de works ───────────────────────────────────────────────

alter table public.works drop column if exists nft_mint_address;
alter table public.works drop column if exists nft_token_uri;
alter table public.works drop column if exists nft_explorer_url;
alter table public.works drop column if exists blockchain_hash;
alter table public.works drop column if exists ipfs_hash;

-- Restos del plagio que works nunca uso: el resultado vive en su propia tabla.
alter table public.works drop column if exists plagiarism_scan_result;
alter table public.works drop column if exists plagiarism_scan_date;

-- ── El codigo de transferencia en claro ─────────────────────────────────────

alter table public.works drop column if exists transfer_code;
alter table public.transfers drop column if exists transfer_code;

-- ── Tablas sin escritor ─────────────────────────────────────────────────────

drop table if exists public.email_deliveries;
drop table if exists public.work_context;
drop table if exists public.work_views;
drop table if exists public.plagiarism_checks;
drop table if exists public.alerts;

-- `alert_type` solo lo usaba `alerts`. Cae con ella para no dejar un huerfano
-- nuevo; `originality_declaration` se queda porque pertenece al plagio, que
-- sigue en pie.
drop type if exists public.alert_type;
