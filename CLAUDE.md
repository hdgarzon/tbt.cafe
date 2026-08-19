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

> **`.gitignore` gap — fix this first.** It currently only ignores `.env*.local`. A file named `.env` or `.env.production` would be committed. Widen it to `.env*` with `!.env.example` before adding any new env file.

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
npm run check:fees   # scripts/fees-check.ts — validates fee math
```

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
  settings/  help/  og/  api/
src/components/brew/  work/
src/lib/                             # supabase client, stripe, auth helpers
src/i18n/messages/                   # translation catalogues
supabase/migrations/                 # 000 → 015, ordered
scripts/fees-check.ts                # fee arithmetic guard
```

### Domains to be careful with

- **Step-up auth** (`014_admin_step_up`, `src/app/admin`) — admin actions require re-authentication with attempt lockout. Never bypass or cache past a session.
- **Fees** — run `npm run check:fees` after touching any pricing, transfer, or purchase path. Fee drift is silent and expensive.
- **Covered registrations** (`011_covered_registrations`) and **tickets** (`012_tickets`) carry real user obligations.
- **Notifications** (`015_notifications`) feed the in-app feed; writes must be idempotent.

### Conventions

- Migrations are strictly ordered and append-only. Never edit a migration that has run in production — add a new one.
- All user-facing copy goes through `src/i18n/messages/`, never inlined.
