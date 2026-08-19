-- ============================================================================
-- 003_spec01_reconciliation.sql — Reconciliación del modelo de datos (Spec 01)
-- ============================================================================
-- Fuente: TBT_Master_Handoff.docx §3 — las 6 discrepancias de esquema.
-- Cada ítem fue VERIFICADO contra la base viva antes de escribir esto.
--
-- No destructiva por diseño: los DROP de columnas quedan DIFERIDOS para que
-- un despliegue gradual nunca se rompa. Aquí solo se marcan como deprecadas.
--
-- Estado de los 6 ítems:
--   1. Pricing duplicado  → se marca deprecado (drop diferido)      [abajo]
--   2. Fee $5 → $8        → se alinea el default de la DB           [abajo]
--   3. RLS duplicado      → se borra el SELECT duplicado            [abajo]
--   4. ownership_history  → YA APLICADO manualmente (RLS on)        [nada aquí]
--   5. Tablas sin TS types→ es cambio de código, no SQL             [nada aquí]
--   6. Columnas NFT x3    → se marca deprecado (drop diferido)      [abajo]
-- ============================================================================

-- ── Ítem 2: alinear el default de la tarifa de creación a $8 ──────────────
-- Debe coincidir con TBT_CREATION_FEE_USD en src/lib/pricing.ts.
alter table public.tbt_payments
  alter column amount set default 8;

comment on column public.tbt_payments.amount is
  'Tarifa de certificación en USD. Fuente de verdad: src/lib/pricing.ts '
  '(TBT_CREATION_FEE_USD). Fijada en $8.00 por Spec 01, ítem 2.';

-- ── Ítem 3: quitar la política SELECT duplicada en transfers ──────────────
-- Verificado: "Participantes pueden ver transferencias" y "Users can view their
-- transfers" tienen expresiones IDÉNTICAS:
--   (from_owner_id = auth.uid()) OR (to_owner_id = auth.uid())
-- Se conserva la de nombre en español (canónica) y se borra la duplicada.
drop policy if exists "Users can view their transfers" on public.transfers;

-- IMPORTANTE: los DOS políticas de INSERT se CONSERVAN — no son duplicados.
-- Son los dos puntos de entrada legítimos de una transferencia:
--   "Propietarios pueden iniciar transferencias" → with_check (from_owner_id = auth.uid())  [vendedor]
--   "Users can create transfers"                → with_check (to_owner_id   = auth.uid())  [comprador]
-- El path del comprador es el que necesita el botón "Buy" de la página pública /work/[id].

-- ── Ítems 1 y 6: marcar columnas deprecadas (SIN borrarlas todavía) ───────
-- Canónico para precio/regalías: la tabla work_commerce.
comment on column public.works.market_price is
  'DEPRECADO (Spec 01, ítem 1). Canónico: work_commerce.initial_price. Drop diferido.';
comment on column public.works.currency is
  'DEPRECADO (Spec 01, ítem 1). Canónico: work_commerce.currency. Drop diferido.';
comment on column public.works.royalty_type is
  'DEPRECADO (Spec 01, ítem 1). Canónico: work_commerce.royalty_type. Drop diferido.';
comment on column public.works.royalty_value is
  'DEPRECADO (Spec 01, ítem 1). Canónico: work_commerce.royalty_value. Drop diferido.';

-- Canónico para NFT: mint_address + token_uri.
comment on column public.works.nft_mint_address is
  'DEPRECADO (Spec 01, ítem 6). Canónico: works.mint_address. Drop diferido.';
comment on column public.works.nft_token_uri is
  'DEPRECADO (Spec 01, ítem 6). Canónico: works.token_uri. Drop diferido.';
comment on column public.works.nft_explorer_url is
  'DEPRECADO (Spec 01, ítem 6). Decisión abierta: guardar vs. calcular al leer. '
  'Hoy se calcula con getExplorerUrl() en src/lib/solana/config.ts.';

-- ── Decisión abierta del handoff: tabla de plagio canónica ────────────────
-- Existían DOS tablas: plagiarism_scans (7 cols) y plagiarism_checks (10 cols).
-- DECISIÓN: la canónica es **plagiarism_scans**.
--
-- Riesgo cero al momento de decidir: se verificó que NINGUNA ruta de la app
-- escribe ni lee ninguna de las dos (solo existían en src/types/database.ts).
-- Drop de plagiarism_checks DIFERIDO, igual que el resto de columnas legacy.
comment on table public.plagiarism_scans is
  'CANÓNICA para resultados de detección de plagio (Spec 01). '
  'Escribe el flujo de certificación tras consultar /api/tbt-image/similarity.';

comment on table public.plagiarism_checks is
  'DEPRECADA (Spec 01). Canónica: plagiarism_scans. Drop diferido — sin escrituras conocidas.';
