# Academy Stripe test: phone checklist

Everything here uses Stripe **Test mode** and fake cards. **Never paste a key into chat.** Keys go only into the Stripe
and Vercel dashboards. Nothing here touches the real course: it stays `draft`.

Current state (2026-11-01): migrations 080 and 082 are in the live Supabase project; the placeholder course
`academy-test-course` exists as `draft` with no price; `ACADEMY_LAUNCH` is off in Production; no Preview deployment of this
branch exists (`vercel.json` disables `claude/*` branches; see step 0).

## 0. Get a preview to exist (needs the owner's yes)
- [ ] Say yes to: "push this commit to a branch named `academy-preview`" (a name Vercel is allowed to build). No merge, no PR.
- [ ] Vercel → Deployments: find the `academy-preview` build, note its URL (it will be protected by Vercel login).

## 1. Stripe (top-left toggle must say Test mode / Sandbox)
- [ ] Product catalog → Add product → name "Academy test course" → one-time → **$29.00 USD** → Save.
- [ ] Open the price and copy its ID (starts `price_`). This one is not secret; you may send it to me.
- [ ] Developers → API keys → copy the **secret key** (starts `sk_test_`). Keep it on your clipboard. Do not send it.

## 2. Vercel → Project → Settings → Environment Variables
For each row: **Add** → Environment = **Preview only** → "Select a custom Preview branch" = **academy-preview**.
Wrong box = wrong environment, so double-check the Environment and the branch before saving.
| Name | Value |
|---|---|
| STRIPE_SECRET_KEY | the `sk_test_` key |
| STRIPE_PRICE_ID | the test `price_` id |
| NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | the live project's values (Supabase → Project Settings → API) |
| ACADEMY_LAUNCH | `1` |
| NEXT_PUBLIC_APP_URL | the preview URL from step 0 |
- [ ] Do **not** edit the existing Production values. The Production rows for Stripe also show "Preview": that shared Preview
      value is overridden by the branch-specific ones above.
- [ ] Redeploy the `academy-preview` branch so it picks them up.

## 3. Stripe webhook (Test mode)
- [ ] Developers → Webhooks → Add endpoint → `https://<preview-host>/api/stripe/webhook`.
- [ ] Select these 7 events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
      `charge.dispute.funds_reinstated`.
- [ ] Reveal and copy the signing secret (`whsec_`); add it in Vercel as `STRIPE_WEBHOOK_SECRET`, Preview, branch `academy-preview`. Redeploy.
- [ ] If Vercel protection blocks Stripe, use Vercel's "Protection Bypass for Automation" and add it to the URL as Stripe instructs.

## 4. Make the placeholder course buyable (Supabase → SQL Editor)
Replace `price_XXXX` with your test price id, then run:
```sql
UPDATE public.academy_courses
SET status = 'published', price_cents = 2900, stripe_price_id = 'price_XXXX'
WHERE slug = 'academy-test-course';
```
- [ ] Check the real course is untouched: `select slug, status from public.academy_courses;` shows
      `build-a-better-baseball-swing` = `draft`.
- [ ] Back out when finished: `UPDATE public.academy_courses SET status='draft', price_cents=NULL, stripe_price_id=NULL WHERE slug='academy-test-course';`

## 5. Run the test (on your phone, preview URL)
Follow `STRIPE-TEST-CHECKLIST.md` with the placeholder course `academy-test-course`: card `4242 4242 4242 4242`, any future date, any CVC.
Tell me each result as pass/fail with a screenshot; I will log it. Include a full refund (step "Full refund") and, last, the dispute steps.

## 6. Clean up
- [ ] Unpublish the test course (step 4 back-out). Delete the Stripe test webhook if not reusing it.
- [ ] Delete the branch-scoped Preview variables when finished.
- [ ] `ACADEMY_LAUNCH` was never set in Production. Leave it that way.
