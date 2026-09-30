-- ============================================================================
-- 063 · The declared value and the naming choice — Work Order 02, Stage 5
-- ============================================================================
--
-- 5.3  A transfer says what kind of value it carries: declared (a sale made
--      elsewhere, entered by the sender), gift (no value), sale (bought
--      through tbt.cafe) or restoring (a refund or a lost dispute, Stage 8).
--      The recipient confirms a declared value by tapping Accept; that time is
--      stored, and that figure is what the history and the record carry.
--
-- 5.5  The recipient's naming choice (M19) is stored on the transfer at
--      acceptance and written to the ownership row at completion. Until it is
--      made, nobody is named (Chains 01 3.3).
-- ============================================================================

alter table public.transfers
  add column if not exists value_kind text,
  add column if not exists declared_value_confirmed_at timestamptz,
  add column if not exists holder_named boolean;

-- Existing rows: two-phase transfers carried a value or none; the rest were
-- purchases. None was confirmed — the field did not exist.
update public.transfers
   set value_kind = case
     when not is_two_phase then 'sale'
     when coalesce(payment_amount, 0) > 0 then 'declared'
     else 'gift'
   end
 where value_kind is null;

alter table public.transfers
  drop constraint if exists transfers_value_kind_check,
  add constraint transfers_value_kind_check
    check (value_kind in ('declared', 'gift', 'sale', 'restoring'));
