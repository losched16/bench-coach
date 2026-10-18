# BenchCoach Academy — decisions and approvals needed

Nothing below is guessed in the product. Where a decision is open, the
feature is built so it stays safely OFF until the decision is made.

## Business decisions (owner)

| # | Decision | Current behaviour until decided |
|---|---|---|
| 1 | **Price** ($19 vs $29 is a test hypothesis in the manuscript) | No price set → the buy button reads "Enrollment opens soon" and checkout refuses (409). |
| 2 | **Refund policy / guarantee** | No refund or guarantee text anywhere. Technically: a full Stripe refund ends access, a partial one does not. Confirm that is what you want. |
| 3 | **Terms, privacy and purchase legal copy** | None exist on the site today. Needed before taking payments from the public. |
| 4 | **Duplicate purchases** (someone pays twice for a course they own) | Access unchanged; the second payment is recorded as `duplicate_purchase` in `academy_stripe_events` for you to refund by hand. |
| 5 | **Promotion codes** in Checkout | Off. |
| 6 | **Trial / subscription pricing in handoff copy** ($10/month in the manuscript is "reconfirm before publication") | The handoff mentions the 14-day trial (true in code) but no monthly price. |
| 7 | **Publish** the course | Imported as `draft`; you publish with one SQL update once 1–3 are done. |
| 8 | **Subscriber CTA "Create My Swing Development Plan"** | Not shown (the manuscript says not to until built and verified). Subscribers get "Open Development Plans", which exists. Phase 2. |
| 9 | **Analytics consent** | Academy events store no personal data (event name, course, lesson; user id only when signed in). Confirm against your privacy policy once written. |

## Editorial review (from the import report)

- Instructor review of all 19 lessons and drills (the manuscript requires it before publication).
- Lessons **3.3** and **5.3** have no "Video to curate" brief.
- **No video is approved.** The four candidates in the manuscript are not assigned to lessons or shown; each needs watching, segment approval and the nine-point checklist. Learners see "being reviewed by the instructor" until then.
- Module 6 ends with a course-completion checkpoint instead of a field test; Lesson 6.4 has no separate "Ready to move on when". Both render as written — confirm intended.
- Credibility block (bio, Cal Ripken World Series) is shown as written — confirm wording.
- Sales page lists "Printable progress checklists": implemented as a printable page built from each lesson's own "Ready to move on when" text and the manuscript's three stages. Confirm this matches what you meant.
- Module titles are shown in title case ("The Foundation") rather than the manuscript's capitals. Words unchanged.

## Approvals needed to go live

- Apply migration `080_academy.sql` to production.
- Apply the generated seed SQL (course content) to production.
- Stripe: Product, one-time Price, and the extra webhook events (README "Going live").

## Phase 2 (not built)

Import the course pathway into a player's Development Plan, drill mapping per
lesson, shareable coach assignments, bundles, league licences,
student/parent reporting.
