-- ============================================================================
-- 072 · The confirmed proof is published — Chains 01, Stage 6.3
-- ============================================================================
--
-- When an anchor confirms, its complete .ots proof goes to Arweave as a proof
-- record (2.4) beside the record it anchors. proof_record_id keeps its bare
-- Arweave ID: that is what lets a Bitcoin anchor be checked after tbt.cafe is
-- gone, and what the work page links (6.4).
--
-- tbt_id: a proof record names its work, and Arweave tags it with the TBT ID so
-- it can be found by tag (the tethered title looks it up that way, Stage 9).
-- New anchors carry it from publishRecord; existing ones are filled from the
-- records they anchor.
-- ============================================================================

alter table public.chain_anchors
  add column if not exists proof_record_id text,
  add column if not exists tbt_id text;

update public.chain_anchors a
   set tbt_id = w.tbt_id
  from public.works w
 where a.tbt_id is null and w.registration_record_hash = a.record_hash;

update public.chain_anchors a
   set tbt_id = w.tbt_id
  from public.ownership_history h
  join public.works w on w.id = h.work_id
 where a.tbt_id is null and h.record_hash = a.record_hash;

update public.chain_anchors a
   set tbt_id = w.tbt_id
  from public.work_amendments m
  join public.works w on w.id = m.work_id
 where a.tbt_id is null and m.record_hash = a.record_hash;
