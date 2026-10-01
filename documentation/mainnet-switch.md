# The switch to mainnet — runbook

Work Order Chains 01, Stage 11. Stages 10 (test-data deletion) and 11 run on one
day, in this order. Stage 12 (public content) is published the same day the
chains run, not before.

No secret goes into this document, the repository, a ticket or a message. Keys
are entered by the person who holds them, directly into Vercel or into their own
shell.

## Before the day — from Federico (§14)

- [ ] Fund the payer wallet with 1–2 SOL (the mainnet payer address).
- [ ] Name the second holder of the offline key backups (authority, storage,
      title signing), and complete the **[who]** marks in
      `documentation/chain-keys-procedure.md`.
- [ ] Subscribe to Helius (Developer plan) on the company card; the RPC URL goes
      to `SOLANA_RPC_URL`.
- [ ] Confirm the two profile lists (kept, deleted) and the eight reserved IDs
      (Stage 10.2). Save the lists as `kept.json` and `deleted.json` (arrays of
      profile ids) outside the repository.
- [ ] Approve the Stage 12 wording, and the Spanish, Portuguese and French
      companion.
- [ ] Generate the mainnet keys: payer, authority, storage, title signing. One
      job each, with offline backups in two places, held by two people. The
      devnet keys are never reused.
- [ ] Rehearse Stage 10: `npm run cleanup:test-data -- --rehearse` against
      production. It deletes inside a transaction that rolls back; every count
      after it must be zero. Send the counts to Federico.

## 11.1 Confirm

- [ ] Stages 1–9 merged; every `npm run check:*` passes; `npm run build` is green.
- [ ] Every item above is done.
- [ ] Open questions that touch the switch are answered (the hourly schedule,
      question s; Turbo, 5.1).

## 11.2 Pause registration and transfers

In the admin console (Config, operator rules), set `pause_registration` and
`pause_transfers` on. Also `pause_selling` and `pause_offers`, so no sale starts
while the register is emptied. Payouts may stay open.

## 11.3 Run Stage 10

1. Take a database backup (Supabase dashboard → Database → Backups) and a
   listing of the `works-media` bucket.
2. `npm run cleanup:test-data -- --execute --kept kept.json --deleted deleted.json --backup-taken`
3. `npm run cleanup:test-data` again: every count must be zero.

## 11.4 Set the network, the keys and the collection

In Vercel → Settings → Environment Variables, **Production only**:

| Variable | Value |
| --- | --- |
| `SOLANA_NETWORK` | `mainnet-beta` |
| `SOLANA_RPC_URL` | the Helius URL |
| `SOLANA_PAYER_PRIVATE_KEY` | mainnet payer |
| `SOLANA_AUTHORITY_PRIVATE_KEY` | mainnet authority |
| `TBT_STORAGE_PRIVATE_KEY` | mainnet storage |
| `TBT_TITLE_SIGNING_PRIVATE_KEY`, `TBT_TITLE_SIGNING_KEY_ID` | mainnet title signing |

Turbo configuration follows Stage 5.1 once its authorisation is answered.

Create the mainnet collection once, from the authority holder's own shell:

```bash
SOLANA_NETWORK=mainnet-beta SOLANA_RPC_URL=… \
SOLANA_PAYER_PRIVATE_KEY=… SOLANA_AUTHORITY_PRIVATE_KEY=… \
npm run chain:create-collection -- --network mainnet-beta --uri <collection metadata URL>
```

Set the printed address as `TBT_COLLECTION_ADDRESS` (Production) and record it
in `documentation/tethered-title-identifiers.md`. Redeploy production.

Then check readiness; `ready` must be `true`:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://tbt.cafe/api/cron/switch-readiness
```

## 11.5 Resume registration only

Set `pause_registration` off. Federico or Sara registers the first real work end
to end.

## 11.6 Verify the first registration

- [ ] The asset on the Solana explorer, owned by the holding address of
      `<TBT ID>-1`.
- [ ] The image and the registration record on two gateways (arweave.net and one
      more from `src/lib/chain/gateways.ts`).
- [ ] The creation provenance record.
- [ ] The anchors pending, then confirmed within hours, with their proof records
      on Arweave (`chain_anchors.proof_record_id`).

## 11.7 Resume transfers

Set `pause_transfers` off (and `pause_selling`, `pause_offers`). For the first
real transfer, verify:

- [ ] The asset moved to the `<TBT ID>-2` holding address.
- [ ] The provenance record carries the holder as chosen, the value, the royalty
      lock and the transaction signature.

## 11.8 Publish Stage 12

Merge the Stage 12 branch (public content: Roast, assistant knowledge, Terms,
privacy policy, interface strings). All five move together, in all four
languages.

## If something fails

- A mint or move that fails leaves the register valid; the recovery sweep
  (`/api/cron/chain-recovery`, Stage 7.3) picks it up, and opens a ticket after
  24 hours.
- A leaked or lost key: `documentation/chain-keys-procedure.md`.
- To stop everything: the five pause switches. Nothing published to Arweave or
  Solana can be undone; pausing is the brake.
