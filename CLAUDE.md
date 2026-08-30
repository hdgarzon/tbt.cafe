# CLAUDE.md

Guidance for Claude when working in this repository.

## Commit and PR rules

**No AI attribution anywhere.** Applies to every artifact that leaves this machine:

- Never add `Co-Authored-By: Claude <noreply@anthropic.com>` or any `Co-Authored-By` trailer naming an AI tool.
- Never add "Generated with Claude Code", "Made with AI", or any similar footer, badge, or sign-off.
- Never mention Claude, Anthropic, ChatGPT, Copilot, "AI-generated", "LLM", or "assistant" in: commit messages, branch names, PR titles, PR descriptions, issue titles or comments, release notes, changelog entries, or code comments.
- Write every commit as the repo author would. Imperative subject, `scope(area): summary` prefix, no emoji, no filler.
- **Commit language: English**, matching existing history (`feat(admin): step-up gate with attempt lockout`).

## Sensitive data — never commit

Treat this repo as if it were public.

**Never stage:**
- `.env` and every variant except `.env.example`.
- Stripe secret keys or webhook signing secrets, Supabase service-role keys, JWT secrets.
- **WebAuthn credential material** — public keys, credential IDs, challenges, or authenticator data pulled from real users.
- Production dumps, or seed/fixture files containing real customer names, emails, phones, or addresses.
- Payment records: real Stripe customer IDs, payment intents, charge IDs, or reconciliation exports.
- Exports from production (CSV, JSON, XLSX), screenshots showing real orders or real users, or logs with real payloads.
- Internal docs naming real customers, real suppliers, or contract pricing. `Documentos/` holds Drive downloads — verify each one before it is ever staged; prefer keeping that directory out of git entirely.

**Migrations (`supabase/migrations/`):**
- Schema, RLS policies, grants and functions are fine.
- Never hardcode a service-role key, real user UUIDs, or seed rows with real people.
- Admin and step-up tables (`013_admin_core`, `014_admin_step_up`) define the privilege boundary — never add a migration that grants broad access without an accompanying policy.

**Rules of thumb:**
- Every example value must be obviously fake: `user@example.com`, `sk_test_xxx`, `Cliente Demo`, `+10000000000`.
- If a doc needs a real payload to be useful, keep the shape and redact the values.
- Never run `git add -A` or `git add .`. Stage explicit paths so nothing rides along.
- If unsure whether a file is sensitive, do not stage it — ask first.

## Commands

```bash
npm run dev          # Next dev server
npm run build        # production build
npm run start        # serve the build
npm run lint         # next lint
npm run check:fees        # fee arithmetic
npm run check:canonical   # canonical serialisation for the chain records
npm run check:records     # the three Arweave records, and what must stay out of them
npm run check:coupon      # promo codes resolve against Stripe, one list only
npm run check:notify      # a simulated send is not a send
npm run check:dispute     # a chargeback leaves a trace
npm run check:approvals   # the two-person rule finishes: approved means applied
npm run check:checkout    # the checkout return URL points at a page that exists
npm run check:context     # no fabricated weather is sealed
npm run check:events      # a failure records what it died of
```

Each guard is a plain script under `scripts/`, written BEFORE the module it
protects. There is no test framework: a guard is a list of assertions that
exits non-zero. Two habits matter when writing one:

- Assert on the **code construct**, never on a bare word. A guard that checks
  `!source.includes('someName')` fails against the comment that explains why
  `someName` is not used. Assert on `someName(` or on the exact interpolation.
- A helper ending in `})` followed by a bare `{` block parses as an arrow
  function. Terminate it with a semicolon.

And one about staging, because it has cost three commits:

- **`git add` aborts the whole command** when any path was already `git rm`'d,
  so nothing else gets staged. If the deletion is already staged, the commit
  then contains only that — a file removed while its callers still reference
  it. Stage the deletion separately, or check `git show --stat` before pushing.

## Architecture

**tbt.cafe** is a Next.js commerce/community app built on Supabase, with Stripe payments and WebAuthn (passkey) authentication including a step-up gate for privileged actions.

- **Stack:** Next.js App Router (`src/`), Supabase, Stripe (`@stripe/react-stripe-js`), SimpleWebAuthn (browser + server), Tailwind, i18n via `src/i18n/`.

### Layout

```
src/app/
  brew/  roast/  grind/  work/       # core product flows
  creator/  collections/  profile/
  purchase/  transfer/  history/     # commerce + ledger
  admin/                             # admin console (step-up protected)
  legal/                             # terms and privacy
  settings/  help/  og/  api/
src/components/brew/  work/
src/lib/                             # supabase client, stripe, auth helpers
src/i18n/messages/                   # translation catalogues
supabase/migrations/                 # 001 → 030, ordered
scripts/*-check.ts                   # one guard per invariant
```

> **The migrations do not describe the whole database.** They start at `001`
> and assume a base schema that exists nowhere in them: `works`, `profiles`,
> `certificates`, `context_snapshots`, `work_commerce`, `tbt_payments`,
> `ownership_history`, `transfers` and `wallets` have no `create table` in any
> migration. 28 of the 44 live tables can be rebuilt from `supabase/migrations`;
> the other 16 cannot.
>
> `supabase/schema-snapshot.sql` fills that hole. It is a **snapshot of the
> destination, not a migration**: it describes where an empty database has to
> arrive, and does not replay how production got there. Regenerate it after any
> migration that changes the schema. Where the two disagree, the live database
> wins — the snapshot is a copy, not the source.
>
> `schema.sql` is a different thing and is git-ignored on purpose: it is where
> `supabase db dump` writes, once the project is linked to the CLI. That is the
> better long-term answer, and it makes the snapshot redundant.

### Domains to be careful with

- **Step-up auth** (`014_admin_step_up`, `src/app/admin`) — admin actions require re-authentication with attempt lockout. Never bypass or cache past a session.
- **Fees** — run `npm run check:fees` after touching any pricing, transfer, or purchase path. Fee drift is silent and expensive.
- **Covered registrations** (`011_covered_registrations`) and **tickets** (`012_tickets`) carry real user obligations.
- **Notifications** (`015_notifications`) feed the in-app feed; writes must be idempotent.
- **Two-person rule** (`013_admin_core`, `src/lib/admin/guard.ts`) — it has *three*
  steps, not two: request, approve, and then the initiator applies. A new
  high-risk action needs an entry in the `APPLY` map in `src/app/admin/page.tsx`
  or it will be approved and do nothing. `npm run check:approvals` fails if one
  is missing.

### Columns that lied

Migration `031` removed them. `works` went from 55 columns to 47, and the pairs
where one half was dead are gone: `nft_mint_address` beside the live
`mint_address`, `nft_token_uri` beside `token_uri`, plus `nft_explorer_url`,
`blockchain_hash`, `ipfs_hash` and the two `plagiarism_scan_*` columns — every
one of them empty in all 59 rows.

The plaintext `transfer_code` went with them, on `works` and on `transfers`. The
transfer code is a bearer secret: whoever holds it can claim the work, which is
why only `transfer_code_hash` is kept.

Recorded because the lesson outlasts the columns: **writing to a dead twin is
silent.** The row saves and the value is never read again. Three of these were
being read by the admin panel, which is why its explorer link never appeared.
When two columns look interchangeable, check which one has data before trusting
either.

### Conventions

- Migrations are strictly ordered and append-only. Never edit a migration that has run in production — add a new one.
- All user-facing copy goes through `src/i18n/messages/`, never inlined.
