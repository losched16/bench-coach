# Chargeback (dispute) handling: proposal

**Status: PROPOSAL, not built, not approved.** Today a chargeback does nothing: the webhook
handles `charge.refunded` only, so a buyer who disputes the charge keeps access until you
act by hand. You asked for handling that allows investigation before final revocation. This is
the smallest design that does that. Nothing here changes behavior until you approve it.

Already decided for planning: a **full refund revokes** access; a **partial refund keeps** it.

## Principle

A dispute is a claim, not a verdict. Cutting a customer off the moment they open one punishes
honest mistakes (a family member who didn't recognise the charge) and can also destroy the
evidence you need to win. So: **flag first, keep access while you investigate, revoke only when
the dispute is lost** (or when you decide to).

## Behavior

| Stripe event | What happens |
|---|---|
| `charge.dispute.created` | Find the enrollment by the charge's payment intent. Record the dispute on it (id, reason, amount, response deadline). Access **stays on**. Show it in `/admin/academy` as "Dispute open, respond by <date>", and notify the owner. |
| `charge.dispute.closed`, outcome **lost** | Revoke: status `revoked`, `revoke_reason = 'stripe_dispute_lost'`, `revoked_at` now. Paid lessons close. Progress rows are kept. |
| `charge.dispute.closed`, outcome **won** (or `warning_closed`) | Clear the flag. Access stays. |
| Owner clicks "Suspend access" on an open dispute | Optional manual step if you suspect fraud: same as revoke but reversible until closed. |
| `charge.refunded` while a dispute is open | Existing rule applies (a full refund revokes). A later `closed/lost` does nothing twice. |

Idempotent through `academy_stripe_events`, like every other Academy event. An event that arrives
out of order (closed before created) is applied correctly because the closing outcome decides, and
the open flag is only informational.

## What it needs (small, additive)

- Migration 082: `academy_enrollments.dispute_id`, `dispute_status` (`open`/`won`/`lost`),
  `dispute_opened_at`, `dispute_due_by`; allow `revoke_reason` values above. No change to who can read
  or write what; enrollments stay server-written only.
- Webhook: two new cases in `lib/academy/webhook.ts` plus a `handleDispute` in `fulfillment.ts`.
- Stripe: add the two events to the endpoint.
- Admin: one list column and one button.

## Evidence for responding (what you will actually have)

Stripe asks for proof of delivery. The Academy keeps: the purchase record, the account email, when each
lesson was first opened and completed (`academy_lesson_progress`), and the enrollment timestamp. It does
**not** store IP addresses or devices, so those cannot be offered. A one-click "export evidence" for a
buyer is part of the admin button above. Decide whether to keep more.

## Tests I would add

Created flags and keeps access; closed/lost revokes; closed/won clears; replayed events change nothing;
out-of-order events; dispute on a refunded enrollment; a dispute on an unknown charge is ignored;
a dispute on a subscription charge is ignored (not an Academy payment).

## Decisions for you

1. Keep access during the investigation (recommended), or suspend on open?
2. Who is notified, and how (email, admin screen)?
3. Do you want a maximum number of days an open dispute may keep access?
4. Do you want repeat disputers blocked from buying again?
5. Approve building it before launch, or launch with manual handling and a written process?
