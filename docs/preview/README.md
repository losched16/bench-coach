# Isolated preview environment (synthetic data only)

Purpose: let the speed program (PR #33) and the Academy (PR #32) be tested on real
phones and with Stripe test mode **without touching production**: a separate
Supabase project, synthetic players, Stripe test credentials, launch flags on only
inside the preview.

**Status: prepared, not created.** Nothing in this runbook has been run against any
cloud account. Creating the Supabase project can add to the organization's bill, and
setting Vercel preview variables changes the project's configuration, so both wait
for your explicit go-ahead (see "What needs your approval").

## The rules this setup enforces

1. A preview never shares Supabase keys with production. Vercel gives a preview the
   same variables as production unless a preview-scoped value overrides them, so
   the override is the whole point of this runbook.
2. Only synthetic people exist in the preview database: `ZZ-SYN` players and
   `*.syn@example.test` accounts. The seed refuses to run on a project that
   already has players or teams.
3. Stripe is test mode only (`sk_test_`). The Academy uses the **sample** manuscript,
   not the paid lessons.
4. Launch flags are off unless you turn them on in the preview, and
   `check-env.mjs` makes that a deliberate act.
5. The preview is behind Vercel Deployment Protection, so a link is not public.

## What can be verified without any cloud account

```
npm run preview:verify
```

Builds the schema from `scripts/preview/migration-order.txt` into a throwaway local
Postgres, runs the synthetic seed, proves the seed refuses a populated project, and
proves `scripts/preview/check-env.mjs` refuses production, a live Stripe key, a
missing production reference, `VERCEL_ENV=production`, and a launch flag left on.

Result on this branch: 22 migrations apply, 7 content migrations are skipped because
they insert drill-library rows that exist only in production's data (they run in one
transaction, so nothing is left half-applied). The preview therefore has **no drill
library and no pathway content**: speed-program exercises show their library-drill
labels by name (the id link stays empty), and the older Development Plans pathways
are empty. That is fine for testing the program, the Academy and Stripe.

## Steps (you, or me after you approve)

### 1. Create the Supabase project
Name it `bench-coach-preview`. Any region. Free tier is fine for this. Not in the
production project. (Organization found: AiMS. I will not create it until you say so.)

### 2. Build the schema
In that project's SQL editor, run the files in `scripts/preview/migration-order.txt`
in order, skipping the `~` ones if they error with a foreign key message. Include
`080_academy` and `081_speed_program`. Start with `000_baseline.sql`.
Check with `scripts/speed-program/verify-prod-readonly.sql` (it is read-only and is
safe on the preview too).

### 3. Create five test accounts
Authentication > Users, using exactly: `owner.syn@example.test`, `admin.syn@example.test`,
`contrib.syn@example.test`, `viewer.syn@example.test`, `outsider.syn@example.test`.
Use strong passwords you store in your password manager. Do not paste passwords
into chat.

### 4. Seed
Run `scripts/preview/seed-synthetic.sql` in the SQL editor. Expect `4` synthetic
players and `0` others. For the Academy, generate the course from the sample text:

```
npm run academy:import -- --manuscript scripts/fixtures/academy-sample-manuscript.md --out /tmp/preview-academy
```

and run the produced `.seed.sql` (Academy branch only). Never load the real paid
manuscript into a preview.

### 5. Stripe (test mode)
In the Stripe dashboard, switch to Test mode: create a product and a one-time price;
copy the `price_...` id into the preview course row; add a webhook endpoint at
`https://<preview-host>/api/stripe/webhook` with the four events listed in
`docs/academy/LAUNCH-READINESS.md`; copy its signing secret.

### 6. Vercel preview variables
Project settings > Environment Variables. **Scope every one to Preview, and to the
branch** (`claude/academy-phase1` or `claude/agility-pathway`), never Production:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | the preview project's |
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | the test endpoint's `whsec_...` |
| `NEXT_PUBLIC_APP_URL` | the preview URL |
| `ADMIN_EMAIL` | `owner.syn@example.test` |
| `SPEED_PROGRAM` / `ACADEMY_LAUNCH` | `1` on that branch's preview only |
| `PREVIEW_ALLOW_FLAGS` | `1` |

Also: enable Deployment Protection for previews, and run
`PRODUCTION_SUPABASE_REF=<prod ref> node scripts/preview/check-env.mjs` in the same
environment (it prints no values) before testing.

### 7. Test
Speed program: `docs/speed-program/MOBILE-QA.md`. Academy:
`docs/academy/STRIPE-TEST-CHECKLIST.md`.

### 8. Tear down
Delete the preview project and the preview variables when finished.

## What needs your approval

- Creating the Supabase project (possible cost; which organization and region).
- Setting preview-scoped Vercel variables.
- Creating the Stripe test product, price and webhook (your Stripe account).
- Triggering a preview deployment.

I have not done any of these. No production setting, key or data was read or changed.
