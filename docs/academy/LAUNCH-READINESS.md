# Academy: launch readiness

**Status: built and tested; not launched; off by default.**
Merging this branch exposes nothing: with `ACADEMY_LAUNCH` unset the public
catalog, sales and preview pages, every navigation link, the sitemap entries,
checkout, payment confirmation and Academy analytics do not exist for visitors.

## The launch flag

| | `ACADEMY_LAUNCH` unset or anything but `1` | `ACADEMY_LAUNCH=1` |
|---|---|---|
| `/academy`, `/academy/[slug]`, preview | 404 for visitors; the site owner (`ADMIN_EMAIL`) sees them with an "Owner preview" banner | public |
| Navigation links (home, use-cases, footer, dashboard) | hidden (they ask `/api/academy/status`, which answers false) | shown |
| Sitemap | no Academy entries | catalog and published courses |
| `POST /api/academy/checkout`, `/confirm`, `/track` | 404 for everyone, the owner included | live |
| `/learn` | 404, except for the owner and for anyone who has already bought a course | live |
| Stripe webhook | **still processed** (a refund or late payment must not be dropped) | processed |
| `/admin/academy` | owner only, as before | owner only |

Turning the flag off later stops selling; it does not lock paying customers out.
Only the exact value `1` turns it on (tested with `true`).

Two further guards stand behind the flag, so enabling it by mistake is still not
enough to sell: a course must be `published`, and have both `price_cents` and
`stripe_price_id`, before checkout will start ("not on sale yet" otherwise).

## Course content inventory (the real manuscript, imported verbatim)

Source: the manuscript file you supplied. Nothing below was written or
recreated by me. The paid text stays in the database and in private,
git-ignored files; it is not in this repository.

| Item | Count |
|---|---|
| Modules | 6 |
| Lessons | 19 (module 1: 3, module 2: 3, module 3: 3, module 4: 3, module 5: 3, module 6: 4) |
| Introduction pages | 3 |
| Resources | 3 |
| Free preview lesson | 1.1 |
| Verbatim check (imported blocks equal to the manuscript) | 185 of 185 |
| Course status in the database | draft; no price; no Stripe price |

### Missing content (reported, not recreated)

| Lesson | What is missing |
|---|---|
| 6.4 | no "field test" section, and no "ready" section |
| 3.3 | no "Video to curate" brief |
| 5.3 | no "Video to curate" brief |

### Video references

- Briefs present for 17 of 19 lessons (all but 3.3 and 5.3). A brief describes what
  to look for; it is internal and never shown to learners.
- **Approved videos: 0 of 19.** Every lesson currently shows its written text only.
- **No video link has been supplied, found or invented.** The importer creates no
  link rows. Each video has to be chosen, credited to its creator, watched by a
  qualified person and marked approved in `/admin/academy` before it can appear;
  a removed or failing link is hidden automatically.

## Stripe: exactly what to configure

You decide the price; nothing here sets one.

1. **Product and price.** One product ("Build a Better Baseball Swing"), one
   **one-time** price (not recurring), in the currency you choose. Copy the
   price id (`price_...`).
2. **Course row.** Set `price_cents` (what the page shows), `currency` (lower-case,
   must equal the Stripe price's currency) and `stripe_price_id` on the course row,
   then set status to `published`. Fulfilment refuses a payment whose price id or
   currency does not match the row.
3. **Webhook.** The existing endpoint `/api/stripe/webhook` handles the Academy.
   Add these events to it: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `charge.refunded`. The signing secret is the existing `STRIPE_WEBHOOK_SECRET`.
4. **Environment** (Vercel, per environment): `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `ADMIN_EMAIL`, and `ACADEMY_LAUNCH=1` last.
   Use **test-mode** keys and a test price on a preview first.
5. **Not set by the code today (your decisions):** tax collection
   (`automatic_tax`), receipts and invoices, promotion codes, billing address
   collection, statement descriptor, refund window. Checkout currently sends
   none of these; each is a deliberate addition, not a default.
6. **Test-mode run, before any real card:** buy with `4242 4242 4242 4242`, confirm
   an enrollment row appears (from the webhook, not the redirect), the success page
   opens the course, a refund in the Stripe dashboard revokes access, and a second
   user cannot open the first user's course.
   *This has not been run against real Stripe. All payment tests use a local fake
   Stripe that I wrote.*

## Legal and policy decisions (not mine to make)

- Price and currency.
- **Refund policy**: window, conditions, and what a refund does (the code revokes
  access on `charge.refunded`). Must be published and linked at checkout.
- **Terms of sale / terms of service** covering a one-time digital course, and a
  **Privacy policy** covering purchasers (name, email, purchase record, progress,
  analytics events).
- **Sales tax / VAT** position and whether to collect it.
- **Audience**: the course is for parents and volunteer coaches about children's
  baseball. Decide whether any COPPA/child-data language is needed (no child
  data is collected by the Academy).
- **Safety and liability notice**: a course safety note exists in the content;
  confirm it with whoever advises you on liability.
- **Third-party videos**: permission or licence for embedding or linking each
  creator's work, and the attribution you show. Nothing is approved yet.
- **Instructor review**: who signs off the lessons as instructionally sound.
- Support contact and complaints process.

## Preview

There is **no preview deployment** of this branch on Vercel today (the project
shows none for `claude/*` branches). Creating one is a deployment, and a preview
normally shares production's Supabase keys, so a preview with `ACADEMY_LAUNCH=1`
would let a tester start a real purchase flow against production data. Use a
separate Supabase project and Stripe test keys for any preview. I have not created
one or changed any configuration.

## Tests (all run locally; CI runs them on the PR)

- `npm run test:academy`: unit checks (including the launch-flag static rules).
- `npm run test:migration-080`: Postgres 16 policies.
- `npm run test:academy-e2e`: full flow with the flag on.
- `npm run test:academy-flag-off`: with the flag off, a visitor, a coach who has not
  bought, a customer who has, and the owner.
