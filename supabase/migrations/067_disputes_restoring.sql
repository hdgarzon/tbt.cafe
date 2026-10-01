-- ============================================================================
-- 067 · Disputes and the restoring movement — Work Order 02, Stage 8
-- ============================================================================
--
-- 8.1  A dispute opens a system ticket in its own category, 'dispute' (65).
--
-- 8.4  restoring joins the transfer types and the ownership-history checks: a
--      refund or a lost dispute returns the work to the seller with a new row,
--      never by undoing the old one (ownership is never reversed).
--
-- Also a fix found here: the live enum transfer_type is (automatic, manual,
-- gift), yet transfer creation writes 'sale' for every valued transfer. Every
-- valued transfer failed at creation. 'sale' joins the enum.
-- ============================================================================

alter type public.transfer_type add value if not exists 'sale';
alter type public.transfer_type add value if not exists 'restoring';

-- Which transfer a restoring row undoes, so a retried refund restores once.
alter table public.ownership_history
  add column if not exists restoring_of uuid[];

alter table public.ownership_history
  drop constraint if exists ownership_history_event_type_check,
  add constraint ownership_history_event_type_check
    check (event_type in ('creation', 'transfer', 'restoring')),
  drop constraint if exists ownership_history_transfer_type_check,
  add constraint ownership_history_transfer_type_check
    check (transfer_type in ('sale', 'gift', 'restoring'));

alter table public.tickets
  drop constraint if exists tickets_category_check,
  add constraint tickets_category_check
    check (category in ('payments', 'payouts', 'transfers', 'registration', 'authentication', 'other', 'claim', 'report', 'dispute'));
