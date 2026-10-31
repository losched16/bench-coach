# Academy price: proposal only

**Proposed: $29.00 USD, one-time, for "Build a Better Baseball Swing".** This is a planning figure
pending the owner's confirmation. It is not set in any database, migration, seed or environment. The
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
- **Changing the price later has a trap.** Fulfilment accepts a payment only if its Stripe price id equals
  the course row's *current* `stripe_price_id`. Someone who started checkout on the old price and pays after
  you switch would be charged but **not enrolled**. To change a price: do it when nobody can be mid-checkout
  (Stripe checkout sessions expire in 24 hours by default), or enroll the stragglers by hand from
  `/admin/academy`. A later code change could accept a list of valid price ids; not done.
- **Currency.** One currency only today.
- **Preview.** The isolated preview uses the same $29.00 in Stripe **test mode** only.

Owner confirmation: ☐ $29 USD  ☐ other: __________   Date: ________
