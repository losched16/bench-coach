# League Layer Phase 1 — audit brief

**Branch:** `claude/new-feature-dev-hhi5lz`
**Head:** `40ef0a87ea456472c467c651e7a6337973c29105`
**Base:** `8d7eefa` (`main`)
**Diff:** 33 files, +5,476 / −33 · 21 new files, 12 modified
**Status:** built, tested, pushed. Migration **not applied** to any database.

You are being asked to audit this before it goes anywhere near a paying league.
This document is written to be read *before* the diff, and it is deliberately
front-loaded with the things most likely to be wrong rather than the things
easiest to defend.

---

## 1. What this is

BenchCoach is a coach-first youth baseball SaaS: authenticated coaches, seasons,
teams, rosters, assistant coaches, practice plans, AI chat, Stripe subscriptions.
Phase 1 of the League Layer adds a B2B tier above that so an entire youth league
can buy BenchCoach and provide it to its coaches.

The governing product constraint, which most of the design follows from:

> Do not create a second version of BenchCoach for league coaches. League
> coaches use the same core product. The league layer sits above it.

Hierarchy: `League → League Season → Division → Team → Coaches`.
Teams are the join — `teams` gained three nullable league FKs, and there is no
second league-flavoured teams table.

### Orientation commands

```bash
npm install                     # node_modules is not checked in
git diff 8d7eefa..HEAD --stat

npx tsc --noEmit                # WRONG — pulls TS 6.x, dies on one config error
./node_modules/.bin/tsc --noEmit    # correct: TS 5.9.3, expect 186 errors
```

**Typecheck baseline is 186 errors, not zero.** Judge changes against the *error
set*, not the count — inserting lines shifts line numbers and makes a naive diff
show phantom changes. Normalise first:

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | grep 'error TS' | grep -v '^\.next/' \
  | sed -E 's/\([0-9]+,[0-9]+\)/()/' | sort | uniq -c | sort
```

One trap worth knowing: **a single syntax error suppresses semantic diagnostics
program-wide**, so a broken file makes tsc report *fewer* errors. During this
work the count dropped to 17 and looked like a 169-error improvement; it was an
ASI parse bug in a new test file. `next.config.js` sets `ignoreBuildErrors` and
`ignoreDuringBuilds`, so nothing else would have caught it.

```bash
# All 21 suites. 18 pre-existing + 3 new.
for s in $(node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>/^(test|verify):/.test(k)).join(' '))"); do
  npm run $s >/dev/null 2>&1 && echo "PASS $s" || echo "FAIL $s"; done
```

The build needs env vars or it dies collecting page data for
`/api/stripe/checkout` on a missing `STRIPE_SECRET_KEY` — pre-existing, not
caused by this change. With placeholders it passes end to end (exit 0):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=ph SUPABASE_SERVICE_ROLE_KEY=ph \
STRIPE_SECRET_KEY=sk_test_ph ANTHROPIC_API_KEY=ph \
NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run build
```

---

## 2. Existing architecture you need to know

Three tables the app depends on **exist only in Supabase, not in repo SQL** —
they were created through the dashboard: `team_members`, `team_invitations`,
`user_events`. Migration 034 handles this by guarding every statement with an
`information_schema` existence check. Migration 050 follows the same pattern.

**Two enforcement points, one model.** API routes use the service-role client,
which bypasses RLS, so `lib/authz.ts` is what protects those paths. Browser
reads go through RLS, defined in migration 034 via `bc_team_role()` /
`bc_team_at_least()` (SECURITY DEFINER, to avoid policy recursion). Team roles
are `owner > admin > contributor > viewer`, on a record-don't-decide model.

**The single entitlement gate before this change** was:

```ts
// lib/authz.ts
export async function assertTeamFeatures(ownerCoachId: string): Promise<void> {
  const { data: coach } = await supabaseAdmin.from('coaches')
    .select('subscription_tier, is_subscribed').eq('id', ownerCoachId).maybeSingle()
  if (!tierConfig(tierOf(coach as any)).teamFeatures) throw new AuthzError(..., 402)
}
```

Keyed on the **team owner**, not the caller — which is why an invited assistant
gets Coach-plan surfaces without paying. That property is the hook the whole
league entitlement design hangs off.

---

## 3. What was built

### Migration `050_league_layer.sql` (474 lines, additive, idempotent)

| Table | Purpose |
|---|---|
| `leagues` | name, slug (unique), logo, city/state, governing body, status (`active`/`inactive`/`pilot`) |
| `league_members` | league **administrators**, → `auth.users`, roles `owner`/`commissioner`/`admin`/`coaching_director`/`division_admin`, unique `(league_id, user_id)` |
| `league_seasons` | "Spring 2027", status `upcoming`/`active`/`completed` |
| `league_divisions` | scoped to league **and** season |
| `league_licenses` | the entitlement source; status `trial`/`active`/`expired`/`suspended`/`canceled`, nullable `coach_limit` |
| `league_invitations` | `email NOT NULL`, `invite_token` unique, status `pending`/`accepted`/`expired`/`revoked` |

`teams` gains `league_id`, `league_season_id`, `league_division_id` — all
nullable, all `ON DELETE SET NULL` (a league leaving is a billing event; it must
never cascade into deleting a coach's roster and season of notes).

Six SELECT policies. **Zero INSERT/UPDATE/DELETE policies** — all writes go
through routes behind `requireLeagueRole`. `league_invitations` has RLS enabled
and **no policy at all**: a table of live bearer tokens readable by any
authenticated user is an account takeover.

### Code

| File | Lines | What |
|---|---|---|
| `app/league-admin/page.tsx` | 640 | commissioner dashboard |
| `app/api/league/invite/accept/route.ts` | 380 | **security-critical** — token-as-credential |
| `components/league/LeagueAdminTables.tsx` | 368 | coach/team/division tables |
| `app/api/league-admin/overview/route.ts` | 343 | **privacy-critical** — adoption reporting |
| `lib/leagueEntitlements.ts` | 317 | pure decision core + resolver |
| `app/league/invite/[token]/page.tsx` | 313 | coach-facing invitation screen |
| `lib/leagueAuthz.ts` | 249 | `requireLeagueRole` / `canManageLeague` / `guardLeague` |
| `app/api/league-admin/invitations/route.ts` | 241 | invite / resend / revoke |
| `lib/leagueInvites.ts` | 233 | pure validation + role mapping + transfer rule |
| `scripts/verify-league-privacy.mjs` | 200 | build-time privacy boundary check |
| `app/api/league-admin/members/route.ts` | 172 | league administrators |
| `app/api/admin/leagues/route.ts` | 152 | provisioning, behind `ADMIN_EMAIL` |
| `app/api/league-admin/teams/route.ts` | 140 | team creation + placeholder ownership |

Modified: `lib/authz.ts` (+36/−9), `app/dashboard/layout.tsx` (+49/−4),
`app/subscribe/page.tsx` (+26), `middleware.ts` (+16), `scripts/verify-authz.mjs`
(+17/−1), `app/auth/signup/page.tsx`, `app/onboarding/page.tsx`,
`app/api/team/invite/route.ts`, `lib/supabase.ts`, `migrations/README.md`.

---

## 4. The five decisions worth challenging

**4.1 — League access is computed, never stored.**
`coaches.is_subscribed` keeps meaning exactly one thing: this person bought a
plan. Sponsorship is answered by asking the licence on every request. The cheap
alternative (set `is_subscribed = true` on sponsored coaches) would leave forty
rows lying the day a league does not renew, with nothing to reconcile them.
*Cost:* a query per entitlement check. *Challenge:* is that cost acceptable on
hot paths, and is there a caching story needed before scale?

**4.2 — Ownership transfers to the head coach on acceptance.**
`teams.coach_id` is `NOT NULL`, so a league admin building February's teams must
own them. Left there, the head coach who accepts in March is a guest on their own
team — no Staff page, no billing, cannot invite their own assistants. So admin
ownership is a **placeholder** that a head-coach acceptance claims. Two guards:

```ts
export function shouldTransferOwnership(opts): boolean {
  if (opts.intendedRole !== 'head_coach') return false
  if (!opts.currentOwnerUserId) return false
  if (opts.currentOwnerUserId === opts.acceptingUserId) return false
  return opts.currentOwnerIsLeagueAdmin   // never take a real coach's team
}
```

The write is compare-and-set on the owner we checked:

```ts
await supabaseAdmin.from('teams').update(update)
  .eq('id', teamId).eq('coach_id', (team as any).coach_id)
```

**This is the highest-risk code in the change and it has never run against a
real database.** It also creates a new `seasons` row owned by the accepting
coach and repoints `season_id`, because seasons belong to a coach and leaving it
pointing at the admin's season gives the head coach a team whose season RLS
forbids them to read.

*Challenge:* is the placeholder model right at all, versus leaving the admin as
owner and accepting the degraded coach experience? Are two guards enough? What
happens to the orphaned admin season rows over several seasons?

**4.3 — `/league-admin`, not `/dashboard/league`.**
`app/dashboard/layout.tsx:loadTeams()` redirects a user with no teams and no
subscription to `/subscribe`. Most commissioners do not coach, so the dashboard
shell would have bounced them to a checkout page for a product their league
already bought. Its own route, own shell, added to the middleware matcher.

**4.4 — Privacy by absence, checked mechanically.**
No policy grants a league member read on `teams` or any content table. Those
tables gate on `bc_team_at_least()`, which resolves through team ownership and
`team_members`; nothing league-shaped appears in any of them. So a commissioner
cannot read a player note because **no path exists**, not because a rule forbids
it. Reporting goes through service-role queries behind `requireLeagueRole`.

**4.5 — Wrong signed-in email is handled, not refused.**
A league secretary types addresses off a registration form; coaches routinely
already have an account under another. Refusing strands a real coach holding a
real invitation. Instead the mismatch is surfaced and must be confirmed with a
checkbox before Accept enables. The token is the credential, exactly as it is for
team invites today. *Challenge:* is confirm-and-proceed the right call, or should
a mismatch hard-fail?

---

## 5. Audit targets, ranked by my own risk assessment

### P0 — Ownership transfer (`app/api/league/invite/accept/route.ts`)

Never executed against a database. Specifically attack:

- Two head coaches opening the same link simultaneously. The `.eq('coach_id', …)`
  guard should make one lose — verify the loser's outcome is sane, not a 500 or
  a silent half-state.
- Transfer succeeds but the `seasons` insert failed first (`season` is null, and
  `season_id` is then simply not updated). Is the resulting team coherent?
- A coach invited as head coach to a team owned by **another real coach** — the
  `currentOwnerIsLeagueAdmin` guard should make them a member instead. Confirm.
- What if the placeholder admin is *also* a real coach with their own teams?
  `ownerIsLeagueAdmin` is true for them, so their team transfers. Is that
  correct, or should it require the team to have no activity?

### P1 — Privacy boundary (`overview/route.ts`, `verify-league-privacy.mjs`)

The verifier greps route source for private table names and forbidden select
columns, and checks migration 050 adds no policy on team-scoped tables. I
negative-tested it against four deliberate violations and all four were caught.

**Known bypass: it does not inspect `.rpc()` calls.** A Postgres function that
returns note content would pass. Also unchecked: dynamic table names, string
concatenation into `.from()`, and any new route placed outside
`app/api/league*`. Please try to defeat it.

Also confirm by reading, not by trusting the verifier, that `overview/route.ts`
never selects: `chat_messages.content`, `player_notes.note`, `team_notes.note`,
`player_traits.note`, `scouting_entries`, `observations`, `entries`,
`prescriptions`, `practice_plans.content`.

### P1 — RLS correctness (migration 050, §8–9)

`bc_in_league_team()` is SECURITY DEFINER and reads `teams` + `team_members`.
It is used in policies on `leagues`, `league_seasons`, `league_divisions` —
*not* on `teams` — so there should be no recursion. **Verify that reasoning.**
Also confirm the `bc_league_rank()` ordering matches `LEAGUE_RANK` in
`lib/leagueAuthz.ts`; if the two disagree, the database and the app disagree
about who runs a league.

### P2 — Entitlement edge cases (`lib/leagueEntitlements.ts`)

Licence liveness is decided by **dates, not the status column**, because nothing
sweeps these rows and a licence still marked `active` months after it ended is
the normal state of the world. `ends_at` is exclusive, `starts_at` inclusive,
unparseable dates fail closed. 81 assertions cover this. Look for a case they
miss — timezone handling and `trial` semantics are the likely gaps.

### P2 — Subscription regressions

`assertTeamFeatures(ownerCoachId, teamId?)` — the league check runs **only** when
the owner's own tier already lacks `teamFeatures`, so paying coaches incur no
extra query and no behaviour change. `guard()` passes `actor.teamId`, which is
now set by every path except `authorizeCoach`. Confirm no existing caller is
affected, and that `/subscribe` cannot loop.

---

## 6. Defects I found and deliberately did not fix

Named here rather than left for you to trip over. All three are real; none is
severe enough that I'd fix it without a decision from the owner.

1. **Concurrent duplicate invitation returns an unhelpful 500.**
   `invitations/route.ts` does select-then-insert against the partial unique
   index `(league_id, lower(email)) WHERE status='pending'`. Two simultaneous
   invites to one address race, and the loser hits a `23505` that surfaces as
   "Could not create that invitation". Should catch `23505` and report it as
   "already invited".

2. **`coach_limit` enforcement is not atomic.**
   The accept route reads the accepted count and then writes. Concurrent accepts
   can both pass and exceed the seat limit. Low impact (a league gets a seat or
   two free) but it is a real TOCTOU.

3. **Pre-existing, unrelated:** `.next/types` flags
   `app/api/workspace/route.ts` for exporting the non-route `checkWorkspaceLimit`.
   Invisible today only because `ignoreBuildErrors` is on. Not touched by this
   change; worth its own fix.

---

## 7. What I could not test, and why

Postgres ports are blocked in this environment and the Supabase service-role
credential is pending rotation, so **nothing was executed against a database.**
Migration 050 has never been applied. Everything verified is static: pure-function
tests, build-time verifiers, typecheck, production build.

Specifically unverified:

- The migration applies cleanly and its six verification queries return the
  expected values (`unaffiliated = teams`, `in_a_league = 0`, all seed counts 0).
- Ownership transfer end to end.
- RLS policies behave as reasoned when evaluated by Postgres.
- The claim that the app **degrades quietly before the migration is applied**.
  The reasoning: supabase-js returns `{data: null, error}` rather than throwing,
  every call site does `(data || [])`, so missing tables yield "no league" and
  `/league-admin` answers "not found". Existing coaches see no change. This is
  reasoned, not observed — **please verify it first**, because it determines
  whether the branch is safe to deploy before the migration runs.
- Mobile rendering of `/league-admin` on a real device.

---

## 8. Acceptance criteria — self-assessment

| # | Criterion | Status |
|---|---|---|
| 1 | Non-league coaches unaffected | Believed yes; needs runtime confirmation |
| 2–5 | League, seasons, divisions, optional team attachment, admins | Built |
| 6–7 | Invite a coach / coach accepts | Built, untested against a DB |
| 8 | Sponsored access without Stripe | Built — `/subscribe` checks sponsorship before its team-membership and legacy-owner branches |
| 9 | League entitlement distinct from individual | Yes — `is_subscribed` never written |
| 10 | Sponsored coach uses normal BenchCoach | Yes — one badge line, one nav item |
| 11–12 | Adoption visible, private content not | Built + enforced by `verify:league-privacy` |
| 13 | Mobile responsive | Cards below `sm`, table above; not device-tested |
| 14 | Expired access removes entitlement | Covered by 81 assertions |
| 15 | RLS on all new tables | Yes; needs runtime confirmation |
| 16–18 | Typecheck / tests / build | 186 = baseline, 21/21 suites, build exit 0 |
| 19–20 | No data deleted, no fake data seeded | Yes — additive only, no backfill, no seed |

**Not done (by design or by gap):** CSV bulk import (Phase 2 per the brief);
division-scoped administration (`division_admin` reserved, ranks lowest, honestly
league-wide read-only); email delivery (no vendor exists in this project — seam
defined in `lib/leagueInviteEmail.ts`, UI shows a copy-link); **no UI for
`/api/admin/leagues`** (provisioning the first league means calling the endpoint
directly as the `ADMIN_EMAIL` user); **no league picker** (an admin of multiple
leagues silently gets `admin[0]`).

---

## 9. Out of scope

Not built, deliberately: scheduling, standings, registration, game scoring,
parent messaging, payment collection, uniforms, field scheduling, tournaments,
sponsor management, league billing portal, AI rules ingestion, commissioner AI
summaries, cross-league benchmarks.

---

## 10. What would most help

In priority order:

1. Break the ownership transfer, or convince yourself it cannot be broken.
2. Defeat `verify-league-privacy.mjs` — find the route shape that leaks content
   past it. The `.rpc()` hole is known; look for others.
3. Confirm the pre-migration degradation claim in §7, since it gates whether
   this can be merged before the migration is applied.
4. Challenge decision 4.2 on product grounds, not just correctness. It is the
   one design choice I would most like a second opinion on.
