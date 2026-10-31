# Isolated preview: exact manual setup steps

For your approval before anything is created. **Secrets are typed or pasted only into the
dashboards named below. Never paste a password, key or secret into chat, a commit, an issue
or a PR.** Nothing here has been done; I have created nothing and changed no setting.

## The setup I am asking you to approve

| Item | Value |
|---|---|
| Supabase organization | AiMS (Pro plan) |
| Supabase project | new, named `bench-coach-preview` |
| Region | **US East (N. Virginia), `us-east-1`** |
| Compute size | the smallest offered |
| Data | schema from this repo + synthetic seed + synthetic drill fixture. **No production player or customer data.** |
| Stripe | **Test mode** only; product "Build a Better Baseball Swing (TEST)", one-time **$29.00 USD** (your proposed price, test only; the real price is not set by this) |
| Vercel | preview deployments of two branches; preview-scoped variables only; Production untouched |
| Launch flags | `SPEED_PROGRAM` and `ACADEMY_LAUNCH` stay unset everywhere except the matching branch's preview |

### Cost (not confirmed)
- **I do not have a quote.** The Supabase tool that creates projects shows the exact price at
  creation and I have not called it. Your organization is on the Pro plan, where each extra
  project's compute is billed by the hour; from public pricing as I remember it, the smallest
  size is roughly $10 a month, which is about $2 for a week of testing. **Treat that as an
  unverified estimate and read the number on the creation screen.**
- Stripe test mode costs nothing. Vercel previews fall under your existing team plan; I have not
  checked your usage limits.
- Deleting the project at the end stops the charge.

## Step 1. Supabase

1. supabase.com/dashboard, organization **AiMS**, **New project**.
2. Name `bench-coach-preview`. Region **East US (North Virginia)**. Smallest compute. Read the
   price shown, then create. Generate the database password in your password manager and paste it
   only into that field.
3. Wait for the project to finish provisioning. Open **Project Settings, General** and copy the
   **Reference ID** somewhere safe. Confirm it is **not** the production project's reference ID.
4. **SQL editor.** Run these files from the repo, in order, one at a time (a new query each):
   `scripts/preview/migration-order.txt` lists them. Start with `migrations/000_baseline.sql`. Include
   `080_academy.sql` and `081_speed_program.sql` (the preview serves both branches). The seven lines
   starting with `~` insert drill-library rows that exist only in production; run them if you like.
   They fail on a foreign key on a new project, and a failure leaves nothing behind. Skip them.
5. **Authentication, Sign In / Providers, Email:** turn **Confirm email** off for this preview only,
   so synthetic buyers can sign up without a real inbox.
6. **Authentication, Users, Add user, Create new user,** tick **Auto Confirm User**, for each of:
   `owner.syn@example.test`, `admin.syn@example.test`, `contrib.syn@example.test`,
   `viewer.syn@example.test`, `outsider.syn@example.test`. Strong, unique passwords, stored in your
   password manager.
7. **SQL editor,** run `scripts/preview/seed-synthetic.sql` (it stops with REFUSED if the project
   already has players or teams). Expect: 4 synthetic players, 0 others.
8. **SQL editor,** run `scripts/preview/seed-drill-fixture.sql` (placeholder drills, only for the
   speed-program mapping). Expect 12 fixture drills.
9. **Academy only.** On your computer, with no database connection:
   `npm run academy:import -- --manuscript scripts/fixtures/academy-sample-manuscript.md --out /tmp/preview-academy`
   then run the produced `.seed.sql` in the SQL editor. This loads the **sample** text, not the paid
   lessons. Then set the test price on the course row (edit the quoted `price_...` after Step 2):
   ```sql
   UPDATE public.academy_courses
      SET price_cents = 2900, currency = 'usd', stripe_price_id = 'price_...TEST...', status = 'published'
    WHERE slug = 'build-a-better-baseball-swing';
   ```
10. Run PART 2 of `scripts/speed-program/verify-prod-readonly.sql` and confirm every row says true.
11. **Project Settings, API.** You will copy three values straight into Vercel in Step 3: the Project
    URL, the `anon` key and the `service_role` key. The `service_role` key bypasses all row security.
    Never put it in chat, in a file or in a screenshot.

## Step 2. Stripe (Test mode)

1. Dashboard, switch the toggle to **Test mode**. Every step below happens with it on.
2. **Product catalog, Add product:** name "Build a Better Baseball Swing (TEST)", **One-time**,
   **$29.00 USD**. Copy the `price_...` id into the SQL in Step 1.9.
3. **Developers, API keys:** reveal the **Secret key** (`sk_test_...`). Copy it straight into Vercel
   (Step 3). Do not use a live key anywhere in the preview.
4. **Developers, Webhooks, Add endpoint,** after Step 3 gives you the preview address:
   `https://<academy-preview-host>/api/stripe/webhook`. Events: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `charge.refunded`. When chargeback handling is built (see `docs/academy/CHARGEBACK-PROPOSAL.md`),
   add `charge.dispute.created` and `charge.dispute.closed`. Copy the endpoint's **Signing secret**
   (`whsec_...`) straight into Vercel.
5. Test cards are in `docs/academy/STRIPE-TEST-CHECKLIST.md`.

## Step 3. Vercel

Project `bench-coach`, **Settings, Environment Variables.** For **every** variable below, untick
Production and Development, tick **Preview only**, and under "Preview" choose **a specific git branch**.
Make one set for `claude/academy-phase1` and one for `claude/agility-pathway`.

| Variable | Value | Branch |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the preview project's URL | both |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the preview project's anon key | both |
| `SUPABASE_SERVICE_ROLE_KEY` | the preview project's service_role key | both |
| `STRIPE_SECRET_KEY` | `sk_test_...` | academy |
| `STRIPE_WEBHOOK_SECRET` | the test endpoint's `whsec_...` | academy |
| `NEXT_PUBLIC_APP_URL` | that branch's preview address | both |
| `ADMIN_EMAIL` | `owner.syn@example.test` | academy |
| `ACADEMY_LAUNCH` | `1` | academy only |
| `SPEED_PROGRAM` | `1` | agility only |
| `PREVIEW_ALLOW_FLAGS` | `1` | both |

Then:
1. **Settings, Deployment Protection:** require Vercel Authentication for **Preview** deployments, so
   the link is not public.
2. Trigger a deployment of each branch (a push, or Deployments, Redeploy on the branch). **I have not
   triggered one.** Branch addresses normally look like
   `bench-coach-git-claude-academy-phase1-clints-projects-2a091ff7.vercel.app`; read the real one in the
   dashboard. Vercel has not built any `claude/*` branch yet, so confirm in Settings, Git that preview
   builds for these branches are enabled.
3. Put the real address into `NEXT_PUBLIC_APP_URL`, into Supabase **Authentication, URL Configuration**
   (Site URL and a redirect URL), and into the Stripe webhook (Step 2.4). Redeploy once more.
4. **Production check, in the dashboard:** open Environment Variables, filter to Production, and confirm
   none of the variables above lists Production, and `ACADEMY_LAUNCH` and `SPEED_PROGRAM` do not exist
   there.

## Step 4. Check it is isolated (no secrets in chat)

In your own terminal, export the preview values yourself (typed there, never pasted to me), then:
```
PRODUCTION_SUPABASE_REF=<production reference id> PREVIEW_ALLOW_FLAGS=1 node scripts/preview/check-env.mjs
```
It prints only ok / FAIL lines, no values. Every line must be ok. Also compare, by eye, the preview
project's Reference ID with production's.

## Step 5. Test

- Speed program: `docs/speed-program/MOBILE-WALKTHROUGH.md` (synthetic accounts only).
- Academy: `docs/academy/STRIPE-TEST-CHECKLIST.md`.
- Review packets: `docs/speed-program/COACH-SIGN-OFF.md`, `docs/academy/REVIEW-PACKET.md`.

## Step 6. Tear down

Delete the Supabase project, the preview variables, the Stripe test product and webhook endpoint.
