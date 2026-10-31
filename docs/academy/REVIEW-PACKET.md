# Academy review packet: what is approved, what is a draft

**Approved by the instructor or owner today: nothing.** This page separates *your* material,
*assistant drafts* and *open decisions*, so no draft is mistaken for approved content.

## 1. Course material (yours, imported verbatim, awaiting approval)

| Item | Status |
|---|---|
| 6 modules, 19 lessons, 3 introduction pages, 3 resources, imported from your manuscript; 185 of 185 blocks match | **Not yet approved by an instructor.** The course is a draft in the database with no price. |
| Free preview: lesson 1.1 | Not yet approved to give away |
| Safety notice | Not yet approved |

The sheet to work through is `LESSON-VIDEO-APPROVAL.md`.

## 2. Assistant drafts (not yours, not approved, not imported)

Private folder `.academy-content/review-drafts/` (git-ignored). Written to match the existing voice
and to add no new technique:

| Draft | Fills | Note |
|---|---|---|
| Field test and "ready" statement for lesson 6.4 | A gap | **It may not be a gap.** `DECISIONS.md` records that Module 6 deliberately ends in a course-completion checkpoint and 6.4 has no separate "Ready to move on". Decide whether to keep your design or take the draft. |
| Video brief, lesson 3.3 | Missing brief | Internal; never shown to learners |
| Video brief, lesson 5.3 | Missing brief | Internal; never shown to learners |

## 3. Videos

**0 of 19 approved.** No video link has been found, supplied or invented. Learners see the written
lesson. No third-party video is described as reviewed anywhere in the product or these documents. A
video is approved only when you record it (SQL in `LESSON-VIDEO-APPROVAL.md`), which requires a
reviewer name and date.

## 4. Planning decisions (yours; recorded as inputs, not yet settled)

| Decision | State |
|---|---|
| Launch price | **$29 USD one-time, proposed; pending your confirmation.** Not set in any database. The preview test price is $29.00 in Stripe **test mode** only. |
| Full refund | Revokes access (this is how the code works today) |
| Partial refund | Access stays (how the code works today) |
| Chargebacks | **Proposal** in `CHARGEBACK-PROPOSAL.md`: flag, keep access while investigating, revoke if lost. Not built; today a dispute does nothing automatically. |
| Terms, Privacy, refund-policy text | None written. Needed before real sales. |
| Tax collection, receipts, promotion codes | Not set in Checkout; each is a decision |

## 5. What stays off

`ACADEMY_LAUNCH` is unset everywhere, so the catalog, sales pages, navigation links, sitemap entries,
checkout and tracking do not exist for visitors. The Stripe webhook stays on, and existing customers
keep access if the flag is later turned off. Nothing was changed in production.

Reviewer: ______________________  Date: ____________
