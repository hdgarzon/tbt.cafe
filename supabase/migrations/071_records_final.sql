-- ============================================================================
-- 071 · The records, in their final form — Chains 01, Stage 2
-- ============================================================================
--
-- 2.1 d  The list of record kinds is open. chain_anchors.record_kind stops
--        being a three-value check and points at chain_record_kinds, so a new
--        kind (TBT-EDNA attachment) is one row, not a rewrite of every check.
--        The same list lives in code as RECORD_KINDS (lib/chain/records.ts).
--
-- 2.2    The creator code. A random code issued once per creator and kept in
--        the register; the registration record carries it as creator.id. It
--        replaces the UUID-derived pseudonym, which anyone could compute
--        because the UUID appears in public URLs. Not readable by the browser:
--        the column grants on profiles (053) do not include it.
--
-- 2.3    What a provenance record is built from, kept where the recovery sweep
--        (7.3) can read it later: the transfer an ownership row came from (its
--        value kind and amount), and the mint signature of the creation.
-- ============================================================================

create table if not exists public.chain_record_kinds (
  kind text primary key
);

insert into public.chain_record_kinds (kind)
values ('registration'), ('provenance'), ('amendment'), ('authentication'), ('proof')
on conflict (kind) do nothing;

alter table public.chain_record_kinds enable row level security;
revoke all on public.chain_record_kinds from anon, authenticated;

alter table public.chain_anchors
  drop constraint if exists chain_anchors_record_kind_check,
  drop constraint if exists chain_anchors_record_kind_fkey,
  add constraint chain_anchors_record_kind_fkey
    foreign key (record_kind) references public.chain_record_kinds (kind);

alter table public.profiles
  add column if not exists creator_code text;

alter table public.profiles
  drop constraint if exists profiles_creator_code_shape,
  add constraint profiles_creator_code_shape check (creator_code is null or creator_code ~ '^cr_[0-9abcdefghjkmnpqrstvwxyz]{10}$'),
  drop constraint if exists profiles_creator_code_unique,
  add constraint profiles_creator_code_unique unique (creator_code);

alter table public.ownership_history
  add column if not exists transfer_id uuid references public.transfers (id) on delete set null;

alter table public.works
  add column if not exists mint_signature text;
