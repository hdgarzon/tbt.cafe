-- ============================================================================
-- 010_two_phase_transfer.sql — Two-phase (authorize-then-capture) transfers
-- ============================================================================
-- Numbered 010, not 004: the remote project already has versions 004-009
-- applied (005-009 belong to the tbt-cafe repo's own migrations folder,
-- which targets this same shared database) even though this repo's local
-- supabase/migrations/ only had 001-003 on disk. 010 is the first number
-- past everything the remote already tracks as applied.
--
-- tbt.cafe Build Spec 02 / Transfer & Commerce Companion: money is authorised
-- when the sender sends and captured only when the recipient accepts. Adds
-- the columns that flow needs on top of the existing `transfers` table
-- (id, work_id, from_owner_id, from_owner_name, to_owner_id, transfer_type,
-- transfer_code, new_owner_name, new_owner_phone, payment_status,
-- payment_amount, payment_currency, payment_reference, payment_link,
-- stripe_checkout_session_id, created_at, completed_at).
--
-- Additive only — the existing single-phase "manual transfer" (/transferir)
-- and buyer-initiated purchase flows are untouched and keep is_two_phase
-- false. This migration does not alter the payment_status check constraint:
-- two-phase rows keep 'pending' meaning "authorised, not yet captured" and
-- only move to 'completed' on actual capture (accept). The three non-accept
-- terminal outcomes (reject / lapse / sender-cancel) all set payment_status
-- to the existing 'expired' value ("this payment attempt did not go
-- through") and record the precise reason in the new `outcome` column.
--
-- Safe to re-run.
-- ============================================================================

alter table public.transfers
  add column if not exists is_two_phase boolean not null default false,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists authorized_at timestamptz,
  add column if not exists outcome text
    check (outcome in ('accepted', 'rejected', 'lapsed', 'cancelled'));

comment on column public.transfers.is_two_phase is
  'true for tbt.cafe payment-first transfers (Build Spec 02). Card is authorised on create, captured only on recipient accept.';
comment on column public.transfers.stripe_payment_intent_id is
  'Manual-capture PaymentIntent backing a two-phase transfer. Needed to capture() on accept or cancel() on reject/lapse/sender-cancel.';
comment on column public.transfers.authorized_at is
  'When the card hold was confirmed (Stripe checkout.session.completed). The 24h accept window is measured from here.';
comment on column public.transfers.outcome is
  'Precise terminal reason for a two-phase transfer that did not (or did) complete. NULL while pending.';

-- One open two-phase transfer per work at a time — createTransfer checks this
-- before authorising a new one, so the index only needs to serve that lookup.
create index if not exists transfers_two_phase_open_idx
  on public.transfers (work_id)
  where is_two_phase and payment_status = 'pending' and outcome is null;
