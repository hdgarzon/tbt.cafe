-- ============================================================================
-- 068 · The token moves on every change of ownership — Chains 01, Stage 4.5
-- ============================================================================
--
-- Placed by Work Order 02 §14 inside the ownership-change path, now that 4.1–4.4
-- are merged. The authority, as permanent transfer delegate, moves the asset
-- from the previous holding to the new one; the signature is stored on the
-- ownership row and goes into its provenance record. Order: token move, then
-- provenance record, then anchor. A move that fails leaves the ownership change
-- valid in the register; the recovery sweep (Chains 01 7.3) retries it and the
-- provenance record waits for the signature.
-- ============================================================================

alter table public.ownership_history
  add column if not exists token_move_signature text,
  add column if not exists token_moved_at timestamptz;
