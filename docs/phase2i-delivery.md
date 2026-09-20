# Phase 2I — Onboarding and Contextual Help: Delivery Report

Supersedes the first version of this report, which was written before any of it
had been opened in a browser. Two of its claims were wrong and are corrected
below.

---

## The short version

The closeout found that **the practice builder had not rendered for anyone
since 2026-09-16.** A `useEffect` sat below an early return in
`app/dashboard/practice/page.tsx`, so React aborted the page on its second
render. Four days, the core screen of the product, and nothing in the repo
could see it: every suite here is a pure-function test, `next build` compiles
it happily, and eslint is not configured.

It took twelve minutes of a real browser to find. That is the headline, not the
help content.

---

## 1. Implemented and tested

Everything in this section has a test that fails if it regresses. "Browser"
means real Chromium against the real app; "unit" means a pure-function suite.

### Fixed in this closeout

| What was wrong | What it did to a coach | Test |
|---|---|---|
| **A hook below an early return** in the practice page | The practice builder rendered nothing at all, since 2026-09-16 | `test:hook-order` scans all 120 component files; verified against the known-bad file |
| **Supabase count errors were ignored.** `{ count, error }` was destructured for `count` alone, and Supabase returns errors rather than throwing | A failed roster query read as "no players", so an established coach got a first-run checklist — and `onboarding_started` fired at them, quietly poisoning the only number that says whether onboarding works | unit + browser (`A FAILED ROSTER COUNT HIDES THE CHECKLIST`) |
| **No guard on stale responses.** Counts for one team could be applied after switching to another | Team A's saved plan could mark team B complete | unit (`a slow team-A response cannot mark team B complete`) |
| **`useUiPref` kept state across account changes** | On a shared phone, an assistant coach inherited the head coach's dismissals from React state — the exact leak `user_ui_prefs` RLS exists to prevent, reintroduced above the database | browser (`ANOTHER ACCOUNT'S DISMISSAL IS NOT INHERITED`) |
| **`useUiPref` merged patches off React state** | Two patches in one tick, and the second silently dropped the first | rewritten to merge off a ref and serialise writes per key |
| **`articleHref` dropped `playerId`** | A coach reading about development plans from Charlie's profile, following one related link, landed back on the roster with Charlie to find again | unit + browser (`THE PLAYER IS ALREADY IN THE RELATED LINK`, `AND SURVIVES THE HOP`) |
| **Dismissing onboarding was a one-way door** | No way back to the checklist, ever | browser (`REOPENING BRINGS IT BACK`, `the original completion timestamp is untouched`) |
| **Eleven screens told coaches to run migrations**, e.g. "Run `migrations/019_metrics.sql` in your Supabase SQL editor" | A volunteer was handed an instruction they cannot perform, naming internal files, that reads as the app being broken | `test:help-content` now scans every non-admin `.tsx` |

On the last one: `migrationHintFor()` now returns a coach-facing `message` and a
separate `operatorMessage` for the server log. One change fixed all 25 API
routes that hand it to a browser. `/app/admin` is deliberately exempt — naming
the file there is the point.

### Verified in a real browser — 56 checks

`npm run test:browser` brings up a fixture Supabase, a dev server pointed at
it, and drives Chromium. **Authentication is not bypassed:** each case signs in
through the real login page and gets a real session cookie written by the real
Supabase client; the real middleware decides whether the dashboard renders.

- **Focus and keyboard.** Focus moves into the panel; Tab is trapped through 30
  presses and Shift+Tab backwards; Escape closes it; focus returns to the
  control that opened it.
- **The page behind survives.** Every heading node is marked, the panel opens
  and closes, and every mark is still there — React did not remount the page,
  so nothing held in it was lost.
- **Dismissal round-trips.** Skip, reload, still gone. Reopen from Help, it is
  back. Dismiss a first-use card, the "How to use this" button remains.
- **The checklist under five conditions:** no roster, existing plans, a
  restricted role, a failed roster count, a failed plan count.
- **Deep links and history.** `?article=` opens directly; related links carry
  the player; back and forward both work and keep the context.
- **Layout at 375px, 430px and 1440px** — no sideways scroll, the panel fits,
  and nothing inside it is clipped. Screenshots in `docs/audits/`.

### What in that is mocked, and therefore not integration-tested

Stated plainly because the distinction matters: **Supabase is a fixture**
(`scripts/browser/fixture-supabase.mjs`, in-memory), **`/api/me` is stubbed**
per case to choose a role, and **`/api/entitlements` is stubbed to a paid
tier**. So these results are statements about the app's own behaviour, and
none of them is a statement about production data, production RLS, production
auth, or billing.

### Test results

| Check | Result |
|---|---|
| `test:browser` | **56 passed, 0 failed** |
| `test:help-content` | 66 passed, 0 failed |
| `test:onboarding` | 54 passed, 0 failed |
| `test:hook-order` | 120 files scanned, 0 problems |
| `test:player-pathways` | 140 passed |
| `test:pathways` | 96 passed |
| `test:pathway-ui` | 60 passed |
| `test:drill-finder` | 114 passed |
| `verify:authz` | 68 routes clean |
| `test-migration-076.sh` | 12 passed on real Postgres |
| `npx next build` | compiled successfully |

**Typecheck: 196 errors, unchanged from the recorded baseline.**

That is not a clean typecheck and the previous report let it read as one. The
repo carries 196 pre-existing type errors and ships with
`typescript.ignoreBuildErrors: true`; `typecheck:baseline` only asserts that
this change added none. During the closeout the number moved to 197 and then
to 5 — the 5 was a broken import that made `tsc` abort early, which is worth
recording because a *falling* error count was the symptom of something worse.
Both were mine and both are fixed.

`npm run lint` is not configured in this repository and was not run. The rule
that would have caught the practice-page crash — `react-hooks/rules-of-hooks` —
is precisely the rule nobody was running, which is why `test:hook-order` now
exists as a standalone scanner.

---

## 2. Implemented but unverified

- **Nothing has been run against production.** Every browser result above used
  a fixture backend. Production data, production RLS and real auth are
  untested by this work.
- **Nothing has been read by a coach.** Whether the prose is actually useful is
  not something a test can answer.
- **Screen readers.** The panel has `role="dialog"`, `aria-modal`, an
  `aria-labelledby` heading and a reachable backdrop button, and focus order is
  verified — but no screen reader was run.
- **Real devices.** Viewports were emulated in Chromium. No physical phone,
  no Safari, no Firefox.
- **The seven guides with no in-product entry point** are readable in the Help
  Center and were checked there, but their contextual placement does not exist
  yet, so it cannot have been verified.
- **`onboarding_reopened`** is emitted by the new Help Center control and
  asserted in the browser suite, but nothing downstream consumes it yet.

### Corrections to the first report

- It said contextual help was mounted on four surfaces and "the other nine
  modules" had none. **There are 11 guides and 4 mounts, so 7 are
  Help-Centre-only**, not nine.
- It listed `/dashboard/player-reports` and `/league` as surfaces to mount help
  on. **Neither is an index page.** `player-reports` exists only as
  `[reportId]`; reports are reached from a player profile. The league admin
  surface is `/league-admin`; `/league` is only an invite link. Section 4 uses
  the real routes, all of which were checked against the filesystem.

---

## 3. Deployment status

Reported separately from code completion, as the release rules require.

- **Already in production:** commit `7691c97`, Vercel deployment
  `dpl_6Psgxew7yxYLDgTwgtXUiKp3bfEh`, state READY. That is the build that
  shipped the help content — **and the build in which the practice page does
  not render.**
- **This closeout:** commit `82a9b95`, Vercel deployment
  `dpl_H6quRyrwDdJr61mKgswG5tmEUVv9`, target production, state **READY**. The
  practice-page fix is live. That the build deployed is verified; that the
  practice builder now renders in production is not — see section 2.
- **No migration is required.** `076_user_ui_prefs` was already applied. This
  closeout adds no schema changes.

---

## 4. Remaining product decisions

Both are yours, not mine, and neither was made here.

1. **Playbooks navigation.** `/dashboard/playbooks` is a real 1,019-line
   feature with no sidebar entry. Its guide says so plainly and deliberately
   offers no action button. Access is unchanged by this closeout. The decision
   is whether it belongs in the sidebar or stays a deep-linked feature.
2. **A support destination.** There is none, anywhere in the product. The Help
   Center now says only that — the previous copy told coaches that telling
   whoever set up their team was "the fastest fix", which described a channel
   that does not exist. **This is a configuration decision awaiting you:** an
   inbox, a form, or a documented escalation path. Once one exists it goes in
   the Help footer and the empty search state. Until then search recovery is a
   "Clear the search" button and the task index, both of which work.

---

## 5. Recommended next rollout

Five modules, in this order. Each is: add a `HelpGuide`, mount `ModuleHelp`,
add the quoted-label assertions, extend the browser suite.

| # | Module | Route (verified) | Note |
|---|---|---|---|
| 1 | **Pitch Counter** | `/dashboard/count` | Highest consequence. See below. |
| 2 | **CoachAI** | `/dashboard/chat` | Guide written; needs the priority-vs-development-plan distinction on the surface itself |
| 3 | **Drill Library** | `/dashboard/drills` | Guide written; must lead with the fact that most drills have no video, since this is where a coach finds out |
| 4 | **Game Day** | `/dashboard/game` | Guide written; mount only |
| 5 | **Lineup Builder** | `/dashboard/lineup` | New guide. Currently reachable only through the game-day guide's synonyms |

### Pitch Counter guidance — what it may and may not say

I read `app/dashboard/count/page.tsx` before writing this. Verified behaviour:

- A rule set (sanctioning body + age group) is **optional** and chosen by the
  coach when they start a count.
- With one chosen, the screen shows the `daily_max` for that rule set, warns
  within 10 pitches of it, and flags going over.
- With none chosen, there is no limit shown at all.
- The count **accumulates per player per date**, so a day's total stays one
  number across sessions. Reopening a finished count keeps adding to the same
  day.
- **It never blocks.** There is no disabled button, no confirmation, no stop.
  A coach can count past the daily max and the app will let them.

So the guide must say: *it tells you where this pitcher stands against the rule
set you picked, and it does not stop you.* It must **not** say the product
enforces a limit, knows your league's rules, or keeps anyone legal. It does not
enforce anything, and a coach who believes BenchCoach is counting against their
league's limit when no rule set is selected has been told something dangerous
about a child's arm. If the rule sets in the database do not match a coach's
league, the guide should say to check with their league rather than implying
the list is authoritative.

---

## 6. Files

New: `lib/onboarding.ts`, `scripts/test-onboarding.ts`,
`scripts/test-hook-order.ts`, `scripts/browser/{fixture-supabase.mjs,
help.spec.mjs,run.sh}`, three screenshots in `docs/audits/`.

Changed: `app/dashboard/practice/page.tsx` (the crash),
`lib/{useUiPref,helpRoutes,migrationHints}.ts`,
`components/help/FirstPracticeChecklist.tsx`, `app/dashboard/help/page.tsx`,
`scripts/test-help-content.ts`, and eleven files whose banners told coaches to
run migrations.

New scripts: `test:onboarding`, `test:hook-order`, `test:browser`.
