# Academy price: proposal only

**$29.00 USD, one-time, for "Build a Better Baseball Swing": approved by the owner for ISOLATED PREVIEW TESTING ONLY.**
It is not the production price, and it is not set in any production database, migration, seed or environment. The owner
confirms (or changes) the production price separately. The
manuscript itself calls $19 vs $29 a test hypothesis.

## How the price is configured (nothing here is applied)

Three fields on the course row, set by hand after the Stripe price exists:

| Field | Proposed value | Notes |
|---|---|---|
| `price_cents` | 2900 | What the page shows ($29.00). Must be greater than zero |
| `currency` | `usd` | Lower case. Must equal the Stripe price's currency or fulfilment refuses the payment |
| `stripe_price_id` | `price_...` | A **one-time** price. Test mode first |

The SQL, for later, in the Supabase SQL editor. Do not run it until the price is confirmed:

```sql
-- PROPOSAL ONLY
UPDATE public.academy_courses
   SET price_cents = 2900, currency = 'usd', stripe_price_id = 'price_REPLACE_ME', status = 'published'
 WHERE slug = 'build-a-better-baseball-swing';
```

A test in the repository fails if any migration or seed ever sets a price.

## Things the price decision touches

- **Tax.** Decide whether $29 is tax-inclusive or tax-exclusive and whether to collect tax (Stripe Tax).
  Checkout does not set `automatic_tax` today.
- **Refund policy wording** (behavior is set: full refund revokes, partial keeps access).
- **Changing the price mid-checkout: fixed.** Checkout now records the price and currency it *offered* in the
  session metadata (written with our secret key; a buyer cannot alter it). Fulfilment holds the payment to that offer,
  not to whatever the course row says later, so a buyer who paid the price they were shown is always enrolled.
  Sessions without that record (none exist before launch) fall back to the course's current price. If a paid payment
  is ever refused for any reason, it is recorded as NEEDS_REVIEW and shown in a red box on `/admin/academy`, never
  dropped silently. Tested: unit (price and currency changed after checkout started, a tampered line item, a missing
  buyer account, replay) and a browser test that changes the price while a buyer is on the payment page.
- **Currency.** One currency only today.
- **Preview.** The isolated preview uses the same $29.00 in Stripe **test mode** only.

Production price confirmation (separate from the preview approval): ☐ $29 USD  ☐ other: __________   Date: ________
