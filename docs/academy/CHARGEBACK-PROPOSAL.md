# Chargeback (dispute) handling: proposal

**Status: IMPLEMENTED on this branch, pending your review. The code is not deployed. Migration 082 (the `academy_disputes` table) is applied to the live Supabase project; nothing reads or writes it until this branch is merged.**

> **Where things stand (2026-11-01).** The owner chose to use the live Supabase project, not a separate preview project:
> it holds only test accounts. Migration 080 was found already applied there (course `build-a-better-baseball-swing`
> is `draft`, 25 lesson bodies, 0 enrollments, row security on for every Academy table). Migration **082 was applied
> there on 2026-11-01** (verified: row security on, no `anon`/`authenticated` privilege). Migration 081 (speed program) is **not**
> applied. A placeholder course `academy-test-course` (draft, no price) was added for Stripe test-mode checks. The real
> course stays `draft`. `ACADEMY_LAUNCH` is off in Production. Nothing is merged; PRs #32 and #33 are drafts.

You asked for handling that allows investigation before final revocation, and for access to be restorable.
The code is `lib/academy/disputes.ts` (about 90 lines), wired into the existing Stripe webhook after signature
verification. Tests: unit checks for every transition and edge case, Postgres checks for the new table, and a browser test that opens, loses and then reinstates a dispute.
It does nothing in production until the branch is merged, migration 082 is applied and the two dispute events are
added to the Stripe webhook endpoint.

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

## What was built

- Table `academy_disputes` (migration 082): one row per dispute with status open/won/lost, reason, amount, response
  deadline, and `access_action` (kept / revoked / restored). Server-only: RLS on, no policy, no client privilege.
- Events handled: `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`.
- Access: unchanged on open. Ended **only** when a dispute closes as lost (`revoke_reason = stripe_dispute_lost`).
  Restored when it closes won, warning-closed, or funds are reinstated, but **only** if this module ended it: a
  refunded enrollment, or one you revoked by hand, is never restored by a dispute.
- Safe against replays and out-of-order events: a repeated event id is skipped; a late "created" after "lost" is ignored.
- Audit: each event writes a row to `academy_stripe_events` naming the dispute and what was done, plus the dispute row.
- Admin: `/admin/academy` shows open disputes with the response deadline.
- You can also restore anyone by hand with the existing Grant button.

## Evidence for responding (what you will actually have)

Stripe asks for proof of delivery. The Academy keeps: the purchase record, the account email, when each
lesson was first opened and completed (`academy_lesson_progress`), and the enrollment timestamp. It does
**not** store IP addresses or devices, so those cannot be offered. A one-click "export evidence" for a
buyer is part of the admin button above. Decide whether to keep more.

## Tests I would add

Created flags and keeps access; closed/lost revokes; closed/won clears; replayed events change nothing;
out-of-order events; dispute on a refunded enrollment; a dispute on an unknown charge is ignored;
a dispute on a subscription charge is ignored (not an Academy payment).

## Decisions for you (the defaults below are what is built)

1. Keep access during the investigation (built), or suspend on open?
2. Who is notified, and how (email, admin screen)?
3. Do you want a maximum number of days an open dispute may keep access?
4. Do you want repeat disputers blocked from buying again?
5. Approve building it before launch, or launch with manual handling and a written process?
