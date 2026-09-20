# Phase 2I — Onboarding and Contextual Help: Delivery Report

Commit `7691c97` · branch `main` · production deployment `dpl_6Psgxew7yxYLDgTwgtXUiKp3bfEh` — **READY**

---

## 1. What was implemented

**A single help content registry.** `lib/helpContent.ts` holds all eleven product
guides as data. Every guide carries a purpose, a one-line summary, the
capability and team it requires, numbered steps, a worked example, a
problems/fixes list, what a coach should see when it worked, and what to do
next. Nothing is generated at runtime — the brief prohibits AI-written product
instructions, and there is no model call anywhere in this feature.

**A content validator that runs as a test.** `contentProblems()` refuses to let
the registry ship with an unresolvable "related" link, a guide with no steps, a
guide with no problems section, an orphaned guide, a URL, a route path, an email
address, an implementation term (`migration`, `RLS`, `schema`, `supabase`,
`jsonb`), or a claim that every drill has a video.

**Contextual guidance components.** `components/help/ModuleHelp.tsx` provides:
- `ModuleHelp` — a first-use card plus a persistent "How to use this" button
- `FirstUseCard` — three steps maximum, dismissible per guide per user
- `HelpPanel` — a `role="dialog"` slide-over with `aria-modal`, a focus trap,
  Escape-to-close, focus restoration, and a real `<button>` backdrop
- `GuideBody` — one renderer shared by the panel and the Help Center article, so
  the two can never drift
- `RelatedGuides` — cross-links resolved through `guideById`, never raw slugs

**A rebuilt Help Center.** `app/dashboard/help/page.tsx` is now organised by what
a coach is trying to do, searches bodies and synonyms rather than titles, and
deep-links articles at `?article=<id>` through `router.push` so browser back
works and a link is shareable.

**A first-practice checklist.** `components/help/FirstPracticeChecklist.tsx`
measures its own completion from `team_players` and `practice_plans` row counts.
Opening a page ticks nothing. Pressing Generate ticks nothing. Pressing "Use this
plan" ticks the final step because that is the press that writes the row. There
is no "mark as done" button, per the brief's prohibition on a meaningless extra
click. It is resumable across sessions and skippable, and it is hidden entirely
from anyone who already has a saved plan, anyone who cannot create plans, and
anyone who skipped it.

**Per-user UI preferences.** `lib/useUiPref.ts` over the new `user_ui_prefs`
table, used for help-card dismissals and checklist state.

---

## 2. Screens and workflows changed

| Surface | Change |
|---|---|
| `app/dashboard/page.tsx` | First-practice checklist; dashboard `ModuleHelp` |
| `app/dashboard/practice/page.tsx` | `ModuleHelp` for practice plans; now reads `useRole` |
| `app/dashboard/roster/page.tsx` | `ModuleHelp` for roster and import |
| `components/PlayerDevelopment.tsx` | `ModuleHelp` with `suppressCard` when the player has no plans, so the card does not stack on the empty state |
| `app/dashboard/help/page.tsx` | Rewritten — task index, body search, deep-linked articles, coaching resources separated, explicit "no support inbox" notice |

**Workflows changed:** none. No button was moved, renamed, or removed. Every
change is additive guidance on top of existing flows.

---

## 3. How guide content and preferences are maintained

**Content** lives in `lib/helpContent.ts` as typed data. To add a guide: append a
`HelpGuide` object, give it at least one task, and run `npm run
test:help-content`. The test will reject it if it is orphaned, unlinked,
stepless, problemless, or says something the validator forbids.

**The labels are checked against the code.** `scripts/test-help-content.ts` reads
`app/dashboard/practice/page.tsx`, `app/dashboard/roster/page.tsx` and
`app/dashboard/chat/page.tsx` as text, extracts every quoted control name out of
the prose, and asserts each one appears in the component that renders it. If
somebody renames "Use this plan", the test fails and the guide gets corrected
instead of quietly lying to a coach standing on a field.

**Coaching advice is separate.** `lib/coachingResources.tsx` holds the
opinion-about-eight-year-olds content, lifted verbatim from the old Help Center,
and renders in its own labelled section. Product instructions are checked against
the code; coaching advice is somebody's judgement. Presenting them as the same
kind of thing was one of the old page's problems.

**Preferences** are rows in `user_ui_prefs`, keyed `(user_id, key)`. Keys are
`help.dismissed.<guideId>` and `onboarding.first-practice`. Every read and write
swallows its own errors — a preference failure must never block a page.

---

## 4. Migrations and configuration

**`migrations/076_user_ui_prefs.sql` — applied to production.**

```
user_ui_prefs(user_id uuid, key text, value jsonb, updated_at timestamptz)
  primary key (user_id, key)
  check (length(key) between 1 and 120)
  check (length(value::text) <= 4000)
```

RLS is `user_id = auth.uid()` on all four verbs, with both `USING` and `WITH
CHECK` on UPDATE. No anon grant.

`coach_preferences` was deliberately **not** reused. It is the AI Memory store —
its rows are surfaced to the coach on the AI Memory page, so writing
`help.dismissed.roster` into it would have shown an implementation flag as if it
were something the coach told the product to remember. It is also keyed on
`coach_id`, which invited staff do not have.

**No configuration changes.** No new environment variables, no third-party
onboarding service, no new dependencies.

---

## 5. Checks run and results

| Check | Result |
|---|---|
| `npm run test:help-content` | **63 passed, 0 failed** |
| `scripts/test-migration-076.sh` (real Postgres) | **12 passed**, including cross-user isolation and "AI Memory is untouched" |
| `npm run test:player-pathways` | 140 passed |
| `npm run test:pathways` | 96 passed |
| `npm run test:pathway-ui` | 60 passed |
| `npm run test:drill-finder` | 114 passed |
| `npm run verify:authz` | 68 routes clean |
| `npm run typecheck:baseline` | **196** — unchanged from baseline |
| `npm run build` | compiled successfully |

`npm run lint` is not configured in this repository and was not run.

Notable assertions inside the 63:
- the practice guide names "Use this plan" and never tells a coach to press Save
- the skill-development guide names the real CoachAI button "Make this the priority"
- nothing in any guide claims every drill has a video, and the drill guide says
  the opposite because most do not
- no email address and no URL appears anywhere in the prose
- "screenshot", "photo", "print", "clipboard", "stages", "parents", "pitch count"
  and "batting order" each find the right guide, and none of those words appears
  in any title — that is the old search's exact failure mode
- a contributor reading the practice guide is told in words that a head coach
  creates plans, and the guide stays fully readable to them

---

## 6. Screenshots and preview evidence

**None. Nothing in this release has been verified in a browser.**

This environment's network policy returns 403 CONNECT for `mybenchcoach.com` and
`*.vercel.app`, and the production aliases sit behind Vercel SSO. Authenticated
testing is not available here, so, per the brief: everything above is
**code-level verification** — tests, a real Postgres RLS run, a typecheck and a
production build. The following are **untested live behaviour** and are not
claimed to work:

- the help panel trapping focus in a real browser
- Escape closing the panel and focus returning to the trigger
- the checklist rendering and ticking against live production data
- deep-linked articles and browser-back in a real address bar
- layout at 375px, 430px and 1440px
- whether any of the prose reads well to a coach

---

## 7. Known limitations

1. **Playbooks has a page but no navigation.** `/dashboard/playbooks` is a real,
   1,019-line feature that is not in the sidebar. Its guide says so plainly
   rather than directing anyone to a menu entry that is not there, and it
   deliberately offers no primary action button — putting Playbooks in the
   sidebar is a product decision, not a help-content fix. **This is open.**
2. **There is no support destination anywhere in the product.** The Help Center
   says so in as many words rather than inventing an address. **This is open.**
3. Contextual `ModuleHelp` is mounted on four surfaces. The other nine modules
   have articles in the Help Center but no in-product entry point yet — that is
   section 9 below.
4. Help content is English-only and not localised.
5. The checklist reads two row counts on dashboard load. On a failed count it
   assumes the coach is established and shows nothing, which is the safe
   direction but means a transient error hides the checklist for that load.
6. Analytics carries `guide_id`, `module`, `entry_point` and `step` only — no
   player names, coach notes, screenshots, chat text, or raw help queries, per
   §7 of the brief. The search box therefore cannot tell you what coaches
   searched for and found nothing.

---

## 8. Branch, commit, deployment

- Branch: `main` (merged from `claude/latest-code-updates-0vrxpr`)
- Commit: `7691c97` — "Tell coaches how the product works, in the product"
- 16 files, +2,804 / −615
- No pull request was opened — this went to `main` under the standing
  authorisation to merge and deploy.
- **Deployment status, reported separately from code completion:** Vercel
  deployment `dpl_6Psgxew7yxYLDgTwgtXUiKp3bfEh` for `7691c97`, target
  production, state **READY**. That the build deployed is verified; that the
  feature works in a browser is not.

---

## 9. Next implementation phase — the remaining modules

The pattern is now fixed and cheap to repeat: add a `HelpGuide` to the registry,
mount `ModuleHelp` on the surface, add the label assertions to
`test-help-content.ts`. Each module below is ordered by how often a coach hits it
and how badly it fails without guidance.

### Tier 1 — a coach meets these in their first week

| Module | Route | Work |
|---|---|---|
| **CoachAI** | `/dashboard/chat` | Guide exists; mount `ModuleHelp`. Needs the priority-vs-development-plan distinction stated on the surface itself, not just in the article. |
| **Drill Library** | `/dashboard/drills` | Guide exists; mount `ModuleHelp`. Must lead with the fact that most drills have no video — this is where a coach discovers it. |
| **Game Day** | `/dashboard/game` | Guide exists; mount `ModuleHelp`. |
| **Lineups** | `/dashboard/lineup` | **New guide.** Currently only reachable through the game-day guide's synonyms. Needs its own article: fairness rules, position eligibility, what the generator will and will not do. |
| **Pitch Counter** | `/dashboard/count` | **New guide.** Highest consequence of any module — pitch limits are a safety rule, not a preference. The guide must state what the product enforces and what it merely displays, and must not imply it enforces a league rule it does not know. |

### Tier 2 — used regularly once a season is underway

| Module | Route | Work |
|---|---|---|
| **Reports** | `/dashboard/player-reports` | Guide exists; mount `ModuleHelp`. |
| **Notes** | `/dashboard/notes` | Guide exists; mount `ModuleHelp`. |
| **Stats** | `/dashboard/stats` | **New guide.** Needs to say plainly what is computed from logged games versus entered by hand. |
| **Scouting** | `/dashboard/scouting` | **New guide**, and the most constrained one to write. The article must reflect the product's existing rules: no cross-account aggregation, and no player-level narrative about opposing children beyond observable baseball facts. Write it so a coach understands those are deliberate, not missing features. |

### Tier 3 — configuration and administration

| Module | Route | Work |
|---|---|---|
| **AI Memory** | `/dashboard/memory` | **New guide.** The one module where a coach genuinely cannot predict behaviour from the UI: what gets remembered, what it changes, how to remove something. |
| **Staff** | `/dashboard/team` | **New guide.** Roles and what each can do. This is where the capability vocabulary becomes visible to a coach, so the words must match what the role selector says. |
| **League** | `/league` | **New guide.** Scope carefully — league admins do not gain player-level access by sponsorship. The guide must not imply otherwise. |
| **Account** | `/dashboard/profile`, `/dashboard/settings` | **New guide.** Billing, team switching, sign-out. |

### Carried into that phase as decisions, not tasks

- **Playbooks navigation** — put it in the sidebar, or leave it as a deep-linked
  feature and say so. Until this is decided the guide stays as written.
- **A support destination** — an inbox, a form, or a documented "ask your league
  admin" path. Once one exists it goes in the Help Center footer and the "nothing
  matches your search" empty state, both of which are currently dead ends.

### Standing rules for every module above

Carried forward from this release and not to be relaxed:

- No AI-generated product instructions at runtime.
- No invented buttons, workflows, capabilities, video links, or support
  destinations. Every quoted control gets an assertion against the component that
  renders it.
- No migrations, no implementation terminology, and no administrative repair
  instructions in coach-facing guidance.
- Opening a page is not completion.
- Telemetry carries ids and modules only.
