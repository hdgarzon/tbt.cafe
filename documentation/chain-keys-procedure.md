# Chain keys: lost or leaked

Chains 01, Stage 7.1.3. One procedure per key. Draft for Federico to complete
the names marked **[who]**.

No key ever appears in code, logs, tickets, messages or this document. The
public addresses are fine to write down; the secrets are not.

## The four keys

| Key | Variable | Job | Backup |
| --- | --- | --- | --- |
| Payer | `SOLANA_PAYER_PRIVATE_KEY` | Holds SOL; pays Solana fees; tops up Turbo credits. | Replaceable; small balance. |
| Authority | `SOLANA_AUTHORITY_PRIVATE_KEY` | Collection update authority and permanent transfer delegate. Signs mints, moves, repoints. | Offline, two holders. |
| Storage | `TBT_STORAGE_PRIVATE_KEY` | Signs every Arweave upload. tbt.cafe's identity on Arweave. | Offline, two holders. |
| Title signing | `TBT_TITLE_SIGNING_PRIVATE_KEY` (+ `TBT_TITLE_SIGNING_KEY_ID`) | Ed25519. Signs each tethered title file. | Offline, two holders. |

All four are **Production only** in Vercel. The authority, storage and
title-signing keys refuse to load in a preview deployment (`src/lib/solana/keys.ts`).
`npm run check:keys` fails if two roles share a variable or a secret.

## For every key, first

1. Tell Federico and **[who]**.
2. Record the time, what is known, and who knew the key. No secret goes in the record.
3. Rotate the Vercel variable only after the replacement below is ready; a
   missing variable fails every mint.

## Payer — lost or leaked

- **Pause:** nothing. Mints fail with a ticket and wait for the sweep.
- **Replace:** generate a new key; move any remaining SOL from the old one if it is
  still controlled; fund the new one with 1–2 SOL; set the variable; redeploy.
- **Leaked:** move the balance out first. The payer signs nothing that carries
  authority, so a leak costs at most its balance.

## Authority — lost or leaked (the one that matters most)

Losing it means tokens can no longer be moved or repointed.

- **Pause:** operators pause transfers platform-wide. Ownership changes wait;
  registrations continue to publish records and wait for the mint.
- **Leaked:** anyone holding it can move any token. Using the offline backup,
  move the collection's update authority and permanent transfer delegate to a new
  key **before anything else** (Metaplex Core `updateCollection` and the
  collection's `PermanentTransferDelegate` plugin authority), then set the variable.
- **Lost with a backup:** restore from the offline copy; no change on chain.
- **Lost with no backup:** the collection can no longer be administered. Tokens
  stay where they are; the register remains the source of ownership. A new
  collection would be needed, and that is a decision for Federico.
- **After:** check every token's owner against the register's current holding
  address; the sweep moves any that differ.

## Storage — lost or leaked

It is tbt.cafe's published signer on Arweave and is never rotated except after a
compromise.

- **Pause:** new uploads (registrations wait for the sweep).
- **Leaked:** someone can publish records that look signed by tbt.cafe. Publish a
  notice in the Roast naming the old address, the time from which it is no longer
  trusted, and the new address. Records signed before that time stay valid.
- **Replace:** new key, fund its Turbo credits, set the variable, update the
  published address (Roast article, `documentation/tethered-title-identifiers.md`).

## Title signing — lost or leaked

Files already downloaded carry the old key ID and stay as they are.

- **Pause:** issuing title files.
- **Leaked:** mark the old key ID revoked from the time of the leak; the server
  check of a file (Title File record §6) answers "revoked" for signatures after it.
- **Replace:** generate a new Ed25519 key, set both variables (secret and new key
  ID), redeploy. Files issued afterwards carry the new ID.

## Offline backups (7.1.2)

Authority, storage and title-signing keys: held by Federico and **[who]**, in two
places each. Check once a quarter that each backup opens and derives the expected
public address.
