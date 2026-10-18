# BenchCoach Academy — Phase 1

Standalone, one-time-purchase courses inside the BenchCoach app and domain.
A course buyer needs a BenchCoach login, and nothing else: no team, no coach
profile setup, no subscription. A subscription never includes a course, and a
course never unlocks the subscription.

Open decisions and approvals: [DECISIONS.md](DECISIONS.md).

## Routes

| Route | Who | What |
|---|---|---|
| `/academy` | public | Catalog: published courses only. |
| `/academy/[slug]` | public | Sales page (manuscript Part XI copy), curriculum outline, buy button. SEO: canonical, Course JSON-LD, in the sitemap. |
| `/academy/[slug]/preview` | public | The one lesson flagged `is_preview` (Lesson 1.1). |
| `/learn` | signed in | My courses. |
| `/learn/[slug]` | enrolled | Course overview, progress, resume. Also the post-checkout landing. |
| `/learn/[slug]/[lesson]` | enrolled | Lesson reading page: blocks, safety callout, drills, approved external videos, mark complete, previous/next, contents drawer on mobile. |
| `/learn/[slug]/checklist` | enrolled | Printable progress checklist (each lesson's "Ready to move on when"). |
| `/admin/academy` | owner | List, grant and revoke enrollments. |
| `/api/academy/checkout` · `confirm` · `enrollment` · `progress` | signed in | One-time Checkout; verify a returning session with Stripe; own enrollment status; reading progress. |
| `/api/academy/track` | anyone | Allowlisted analytics events into `user_events`. |
| `/api/academy/admin/enrollments` | owner | Grant/revoke (404 to everyone else). |

`/learn` is behind the middleware sign-in check (redirects to login with a
same-site `redirect`), `noindex`, and disallowed in robots.txt. It does **not**
go through the `/dashboard` subscription/team gate. The dashboard gains an
"Academy" item (tooltip "Learn a skill") next to Playbooks ("Run a preset
program") and Development Plans ("Track this player's growth").

## Data (migration `080_academy.sql`)

| Table | Holds | Readable by |
|---|---|---|
| `academy_courses` | slug, title, status, preview lesson, safety note, price, Stripe price id, related pathway | anyone, when `published` |
| `academy_modules`, `academy_lessons` | the outline: titles, numbers, minutes | anyone, for a published course |
| `academy_lesson_bodies` | the paid lesson text (structured blocks) and field tests | the preview lesson, or an **active enrollment** |
| `academy_video_links` | external demonstrations with reviewer, date, link health | `approved` rows only, same rule as the text |
| `academy_enrollments` | who has which course, how (purchase / grant), Stripe ids, revoke/refund | the owner of the row; **no client writes at all** |
| `academy_lesson_progress` | reading marks (opened / completed) | own rows; writes need an active enrollment |
| `academy_stripe_events` | Stripe events already acted on (replay protection) | service role only |
| `academy_editorial_flags` | the import's review list | service role only |

`npm run test:migration-080` proves these rules in Postgres with Supabase's
`anon`/`authenticated` roles (36 checks).

Lesson **progress is reading progress**. Skill progress stays in the existing
Player Development Plans (`player_pathway_*`). `academy_courses.related_pathway_slug`
points the swing course at the existing `build-the-swing` pathway for Phase 2;
nothing is duplicated.

## Content: why it is not in the repository

The repository is public. Lesson text lives in `academy_lesson_bodies` behind
row-level security, loaded from the private manuscript:

```bash
npm run academy:import -- --manuscript /path/to/benchcoach_academy_swing_course.md
# → .academy-content/build-a-better-baseball-swing.seed.sql   (paste into the SQL editor after 080)
# → .academy-content/build-a-better-baseball-swing.report.md  (editorial review list, video briefs)
```

The importer splits the manuscript into structured blocks without rewriting a
word (a check reassembles every block and requires an exact match: 185/185).
"Video to curate" briefs and Parts X–XIII never become learner content.
Re-importing is safe on a live course: it never changes status, price or the
Stripe price, and a lesson removed from the manuscript becomes `draft` rather
than being deleted (so nobody's progress is lost). The course is created as
`draft`.

## Payment and access

1. Buy button → `/api/academy/checkout` (signed in; buyer = session user).
   Stripe Checkout, `mode: payment`, the course's own Stripe price,
   `metadata.kind = academy_course`, `client_reference_id = user id`.
2. Stripe webhook (`/api/stripe/webhook`, signature verified) hands Academy
   events to `lib/academy/webhook.ts` **before** the subscription code, which
   now also ignores any non-subscription checkout. Fulfilment checks paid
   status, buyer identity, the exact price and currency, then upserts one
   enrollment. Replayed events are skipped; one checkout session can enroll
   once; concurrent deliveries are safe.
3. The return URL is only a hint: `/learn/[slug]?purchase=success` asks the
   server to retrieve the session from Stripe (for the signed-in buyer only)
   and waits for the enrollment.
4. A **full** refund (`charge.refunded`) ends access; a partial refund does not.
   The owner can grant (comp) or revoke in `/admin/academy`.

## Going live — checklist

1. Apply `migrations/080_academy.sql` (SQL editor). Verify every `academy_*`
   table shows RLS on.
2. Run the import, apply the seed SQL. The course exists as `draft`.
3. Review the course as the owner (the admin email sees drafts with a banner).
4. Stripe: create a Product and a one-time Price. Add these events to the
   existing webhook endpoint: `checkout.session.completed` (already there),
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `charge.refunded`.
5. When the decisions in DECISIONS.md are made:
   `UPDATE academy_courses SET price_cents = …, stripe_price_id = 'price_…', status = 'published' WHERE slug = 'build-a-better-baseball-swing';`
6. Approve videos one by one (`approval_status = 'approved'`, `reviewed_by`,
   `reviewed_at`). Until then lessons say a demonstration is being reviewed.
7. Do one real purchase end to end with a test card in Stripe test mode, then
   a refund, before switching to live keys.

## Adding a course

Add a catalog entry in `lib/academy/catalog.ts` (slug, preview lesson, public
copy), write the manuscript in the same format, import it. No route, table or
component is course-specific.

## Tests

| Command | Covers |
|---|---|
| `npm run test:academy` | parser (synthetic fixture in CI; `ACADEMY_MANUSCRIPT=…` adds the real manuscript), seed safety, fulfilment (paid, unpaid, wrong price/currency/buyer, replay, race, duplicate purchase, refund, re-purchase), webhook routing, safe redirects, route rules — 71 checks (+6 with the manuscript) |
| `npm run test:migration-080` | RLS and constraints in Postgres — 36 checks |
| `npm run test:academy-e2e` | browser: logged-out catalog/sales/preview, parent sign-up → checkout → webhook → course on a phone, webhook replay, forged webhook, unauthorized lesson access, made-up return URL, confirm-without-webhook, coach subscriber nav and handoff, refund and owner revoke, broken/candidate videos, not-on-sale and draft, 375/430/1440 layouts — 65 checks. Screenshots in `.academy-content/e2e/` (git-ignored). |
