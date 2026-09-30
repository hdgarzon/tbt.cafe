# Tethered title identifiers

Chains 01, Stage 9.2. The contract the title file (G1) builds against.

A downloaded title file can never be updated. What it carries is fixed here,
before G1 is built, and the renderer embeds exactly this list — nothing more,
nothing less. Adding an identifier later means files already in people's hands
lack it, so a change to this list is a new file version, not an edit.

## What the file carries

| Identifier | Used for |
| --- | --- |
| Title number, TBT ID, issue date | The question sent to tbt.cafe, and the display. |
| Document signature and title-signing key ID | The server check of the file (Title File record §6). |
| Registration record ID and hash | Arweave check: the record exists and matches. |
| This holding's provenance record ID and hash | Arweave check for this holder. |
| Storage key address | Confirms the records were signed by tbt.cafe. |
| Record hash to look up the proof | Bitcoin check: finds the proof record on Arweave by tag, since a title is issued before its anchor confirms. |
| Collection address, asset address, holding address | Solana check: token still at this holding → current; moved → void. |
| Gateway lists per chain | Arweave gateways (Stage 5.5); public Solana endpoints; Bitcoin block-header sources (for example mempool.space and blockstream.info). |

## Forms

- **Record IDs** are bare Arweave transaction IDs, never gateway URLs (Stage 2.1 a).
  The gateway lists are carried separately so a verifier can choose one.
- **Hashes** are lowercase hex SHA-256 of the exact bytes uploaded.
- **Addresses** are base58 Solana public keys.
- **Title number** is `<TBT ID>-<owner index>`, e.g. `RRO5501-3`.

## The holding address

The holding address is derivable by anyone from the title number, so the file
carries it for convenience, not as the only source:

```
findProgramAddressSync(["tbt-holding", <title number>], HOLDING_NAMESPACE)
HOLDING_NAMESPACE     = F9ieqDeu9tk2eBeMLXdRdtyagHVhdR9uNbqqJBjPgg3q
                      = SHA-256("tbt.cafe/holding-namespace/v1/2")
```

The namespace is off the ed25519 curve, so no private key exists for it or for
any holding address derived from it. Anyone can check that by hashing the tag.
Source: `src/lib/solana/holding.ts`; guard: `npm run check:holding`.

## What the file never carries

No email, phone, coordinates, internal UUID, price, royalty, or transfer code —
the same rule `assertNoIdentifiers` applies to every record.

## Devnet values (29 September 2026)

Public values only. The secrets live in Vercel Production and in the offline
backups; see `documentation/chain-keys-procedure.md`.

| Identifier | Devnet value |
| --- | --- |
| Collection address (Stage 4.2) | `EWCYT4EH9Zvxfna7L7CTx2219cJRWB2RP83My9nxodAt` |
| Authority address (update authority and permanent transfer delegate) | `8RQ3BZXPMeCY9yUTHREK3wh5CtvCn589QaJETJEFjCFp` |
| Storage key address (Stage 5.2) | `8qKcyR4Lju8XvZSBdLJVH8yiS2g1xPUauGoxQ8D6bA6b` — not signing uploads until Turbo (5.1) |
| Title-signing public key (Stage 9.1) | `9A8nQt7pdfo6brRFLnnbDrhZQzuBLE4AZQjMWnT6aZuX` |
| Title-signing key ID | `ts-7a928033ee35eeb2` = `ts-` + first 16 hex of SHA-256 of the public key bytes |

Mainnet gets its own four keys and its own collection on the day of the switch
(Stage 11); none of these carry over.
