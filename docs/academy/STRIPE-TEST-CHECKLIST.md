# Academy: real Stripe test-mode purchase and refund checklist

Run only with Stripe in **Test mode** and a Vercel **Preview** deployment of this branch (never Production), using the placeholder
course `academy-test-course` (not the real manuscript course). The database is the live Supabase project, which holds only test accounts
(see `PHONE-CHECKLIST.md`); the older isolated design is in `docs/preview/README.md`. The public catalog and purchasing stay off in
production. Everything below uses fake money and test cards.

Before starting: `PRODUCTION_SUPABASE_REF=<prod ref> node scripts/preview/check-env.mjs` passes in
the preview environment, `ACADEMY_LAUNCH=1` and `PREVIEW_ALLOW_FLAGS=1` are set for that preview only,
and the preview course (from the **sample** manuscript) is `published` with `price_cents = 2900`, `currency = 'usd'`
and `stripe_price_id` set to your TEST product ($29.00 is the proposed price, used here only in test mode).

Stripe test cards: success `4242 4242 4242 4242`; declined `4000 0000 0000 0002`;
3-D Secure required `4000 0025 0000 3155`. Any future expiry, any CVC, any postcode.
Accounts: `owner.syn@`, `contrib.syn@`, `viewer.syn@`, `outsider.syn@` `example.test`. The buyer is created at signup.

## 1. Before anyone buys
- [ ] Signed out, `/academy` and the sales page load (flag on), the buy button shows the test price, the free preview lesson reads without an account, **no paid lesson text** appears in the page source.
- [ ] `/learn/<course>` signed out sends you to log in.
- [ ] With the flag off (unset it, redeploy) the same URLs are not found, and `POST /api/academy/checkout` is 404.

## 2. A successful purchase
- [ ] Sign up a new synthetic buyer, tap Buy: you land on Stripe Checkout in test mode with the right product, price and currency.
- [ ] Pay with `4242...`. You return to the course with a welcome message.
- [ ] **Access came from the webhook, not the redirect.** In Stripe > Developers > Webhooks the `checkout.session.completed` delivery is 200, and exactly one row exists in `academy_enrollments` for this user (status `active`, source `purchase`, a payment intent id).
- [ ] One row exists in `academy_stripe_events` for that event id.
- [ ] Paid lessons now open; progress saves; "Mark complete" and resume work; the printable schedule prints.

## 3. The redirect proves nothing
- [ ] As a *different* signed-in synthetic user, open the success URL of someone else's session (`?purchase=success&session_id=...`): you are **not** enrolled and cannot open paid lessons.
- [ ] Open the success URL without paying (a cancelled or abandoned session): not enrolled.
- [ ] Cancel at Stripe: you return to the sales page with a "cancelled" notice and no enrollment row.

## 4. Failures and edge cases
- [ ] Declined card `4000 0000 0000 0002`: no enrollment; a clear message; you can try again.
- [ ] 3-D Secure card `4000 0025 0000 3155`: completes only after authentication; enrollment appears only after success.
- [ ] Buy the same course twice (second tab, or after success): no second enrollment row, no second charge (the page says you already own it, or the duplicate is flagged for refund).
- [ ] Resend the same `checkout.session.completed` event from Stripe: still one enrollment, the event is recorded as already seen.
- [ ] Tamper check: a payment whose price or currency differs from what that checkout offered is refused (`line item does not match the price offered` / `currency mismatch`), does not enroll, and shows up in the red "Paid, but no access was granted" box on `/admin/academy`.
- [ ] **Price change mid-checkout.** Start a purchase and stop on the Stripe page. In the SQL editor change the course's `stripe_price_id` to another test price. Finish paying. The buyer is enrolled once, and nothing appears in the red box. Put the price back afterwards.

## 5. Refunds
- [ ] **Full refund** from the Stripe dashboard: `charge.refunded` arrives (200); the enrollment becomes `refunded` with `revoke_reason = stripe_full_refund`; the buyer can no longer open paid lessons; their progress rows remain.
- [ ] **Partial refund**: access is **unchanged** (this is how the code behaves today). Confirm that matches your refund policy.
- [ ] After a full refund, the buyer can buy again and is enrolled once.
- [ ] Resend the refund event: nothing changes twice.

## 6. Isolation
- [ ] A buyer cannot read another buyer's enrollment, progress, or lessons (try the other's URLs and the API).
- [ ] A contributor/viewer on a BenchCoach team has **no** course access unless they bought it (a team role is not a purchase).
- [ ] The owner (`ADMIN_EMAIL`) can grant and revoke by hand in `/admin/academy`; a manual grant is recorded with who granted it.
- [ ] A subscriber to BenchCoach does not get the course free, and a course buyer does not get a subscription.

## 6b. Chargebacks (test mode)
Add the dispute events to the test webhook first (`charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`) and apply migration 082 to the **preview** database.
- [ ] Buy with the dispute test card `4000 0000 0000 0259`. A dispute opens within moments. In the preview database a row appears in `academy_disputes` with status `open`, and `/admin/academy` shows "Open disputes".
- [ ] **The buyer still has access** while it is open.
- [ ] In Stripe, respond to the dispute with the test evidence text `losing_evidence`. When it closes as lost, the enrollment becomes `revoked` with reason `stripe_dispute_lost`, and the paid lessons close.
- [ ] Repeat with another buyer using `winning_evidence`: the dispute closes as won and access is untouched (or **restored**, if you had revoked it).
- [ ] Resend any dispute event from Stripe: nothing changes twice.
- [ ] A dispute on a BenchCoach **subscription** payment is ignored by the Academy.

## 7. Known gaps to decide before launch
- **Chargebacks** are handled as described in `CHARGEBACK-PROPOSAL.md` (built, pending your review). Section 6b is the test.
- Tax, receipts/invoices, promotion codes and billing-address collection are not set in checkout. Decide each.
- Partial refunds keep access and full refunds revoke it (your planning decision; matches the code).
- No real card has ever been charged. This checklist is the first real test of the Stripe side; all earlier payment tests used a local fake.

## 8. Clean up
- [ ] Delete the test product, price and webhook endpoint if you will not reuse them; delete the preview project and the preview variables.

Run by: ______________  Date: ________  Result: ☐ every box ticked  ☐ exceptions listed: ______________
