# League Layer Phase 1 — current-head audit

**Branch:** `claude/new-feature-dev-hhi5lz`
**HEAD at audit:** `58f4118` (remediation) — supersedes `f117496`
**Base:** `8d7eefa` (`main`)
**Migration 050:** amended this pass. **Not applied to production.** Applied only
to a throwaway local PostgreSQL 16 cluster that is destroyed on exit.

This replaces `league-layer-phase1-audit-brief.md`, which described `40ef0a8`.

---

## 1. Provenance of the previous brief

The brief recorded head `40ef0a8` while the branch sat at `f117496`. That gap is
benign and self-explanatory: `f117496` added *only* the brief itself. A document
cannot record the hash it creates.

```
git diff --name-status 40ef0a8..f117496
A  docs/audits/league-layer-phase1-audit-brief.md
```

Zero changes under `lib/`, `app/`, `migrations/`, `scripts/`, `components/`,
`middleware.ts`, `package.json`. Nothing touched entitlements, ownership
transfer, RLS, invitations, privacy, reporting or subscriptions. **The brief's
technical claims described `f117496` exactly**, and it was a sound basis to
re-audit from.

---

## 2. What changed in this pass

| File | Change |
|---|---|
| `migrations/050_league_layer.sql` | `teams.league_placeholder_owner_id`; `bc_claim_league_seat()`; `bc_release_league_seat()`; role-guarded REVOKE/GRANT |
| `app/api/league/invite/accept/route.ts` | claim-first ordering; seat release on failure; fail-closed season; literal-table activity check |
| `lib/leagueInvites.ts` | `shouldTransferOwnership` → `decideOwnershipTransfer` with reasons |
| `app/api/league-admin/teams/route.ts` | records the placeholder marker at creation |
| `app/api/league-admin/invitations/route.ts` | `23505` → 409 |
| `scripts/verify-league-privacy.mjs` | rpc allowlist, dynamic-`from` refusal, embed parsing, content discovery, grant checks |
| `scripts/test-league-entitlements.ts` | 81 → 171 assertions |
| `scripts/test-league-invites.ts` | 57 → 66 assertions |
| `migrations/050_VERIFY.sql` | **new** — 35 database assertions, transactional, rolls back |
| `scripts/test-migration-050.sh` | **new** — throwaway cluster, idempotence, real concurrency |

### Migration 050 was amended, not superseded

It has never been applied to any database, so no deployment carries the old
shape, and adding a `051` to patch a migration that never ran would create
permanent archaeology for no benefit. **Re-read 050 as a whole rather than
diffing it.**

---

## 3. Issues found

### P0-1 — Invitation claimed *after* every side effect · FIXED

The order was: create coach row → transfer team → insert membership → *then*
attempt `UPDATE ... WHERE status='pending'`. Two concurrent accepts both passed
validation, both wrote, and only then did one lose — with its writes committed.
The brief called this "the highest-risk code"; it was worse than described,
because the compare-and-set it relied on ran last.

### P0-2 — Season insert failure transferred the team anyway · FIXED

```ts
const { data: season } = await supabaseAdmin.from('seasons').insert(...)  // error ignored
const update = { coach_id: coachId }
if ((season as any)?.id) update.season_id = (season as any).id            // silently skipped
```

Ownership moved while `season_id` still pointed at the administrator's season —
precisely the incoherent state the design was supposed to prevent, since seasons
are coach-owned and RLS would forbid the new owner from reading it.

### P0-3 — Placeholder status inferred from the owner's league role · FIXED

`currentOwnerIsLeagueAdmin` is true for a commissioner who *also coaches a team
in their own league*. Their real team — real roster, real practice plans — would
have been transferred to whoever opened a head-coach invitation pointing at it.

### P1-1 — `coach_limit` read-then-write · FIXED

Demonstrated rather than assumed. A faithful reproduction of the old pattern,
raced by 12 connections against 3 seats:

```
OLD (read-then-write, no lock): winners=12, accepted=12 — seats available: 3
```

A 4× overshoot. Not theoretical.

### P1-2 — Duplicate pending invitation surfaced as a 500 · FIXED

### P1-3 — Privacy verifier bypasses · FIXED

`.rpc()`, non-literal `.from()`, PostgREST embedded joins, and league surfaces
outside `app/api/league*` were all unchecked. Additionally the verifier did not
check that the new `SECURITY DEFINER` functions were revoked from the browser
client — which, had it not been added, would have been a hole straight through
every RLS policy in the file.

### P2-1 — Duplicate seasons on second acceptance · FIXED
A coach accepting two head-coach invitations in one league season got two
identically named seasons. Seasons are now reused by name.

### P2-2 — `.next/types` non-route export · NOT FIXED (pre-existing)
`app/api/workspace/route.ts` exports `checkWorkspaceLimit`, which Next flags as
an invalid route export. Visible only when `.next/types` exists, and invisible in
CI because `ignoreBuildErrors` is on. **Untouched by this branch** and excluded
from the typecheck delta below. Worth its own fix.

---

## 4. Fixes, with the test that covers each

| Issue | File | Before | After | Covered by |
|---|---|---|---|---|
| P0-1 | `accept/route.ts` | claim last; loser's writes committed | claim first via locked RPC; seat released on any later failure | `test:migration-050` — 8 connections race one invitation, exactly 1 wins |
| P0-2 | `accept/route.ts` | season error ignored, transfer proceeded | season created first; failure aborts before ownership moves; released seat | `test:league-invites` refusal reasons; manual read |
| P0-3 | `leagueInvites.ts`, `teams/route.ts`, migration | owner's league role | recorded `league_placeholder_owner_id`, cleared on claim, plus no-activity check | `test:league-invites` — "a league admin's OWN real team is never transferred"; `050_VERIFY` placeholder block |
| P1-1 | migration, `accept/route.ts` | read-then-write | `FOR UPDATE` on the licence inside `bc_claim_league_seat()` | `test:migration-050` — 12 claims / 3 seats → exactly 3 |
| P1-2 | `invitations/route.ts` | generic 500 | 409 `already_invited` | `050_VERIFY` — "duplicate pending invitation was REJECTED" |
| P1-3 | `verify-league-privacy.mjs` | literal `.from()` only | rpc allowlist, dynamic-from refusal, embeds, content discovery, grant checks | negative-tested against 5 bypass classes |
| P2-1 | `accept/route.ts` | new season each time | reused by name | manual read |

---

## 5. Ownership transfer — final design

**Ownership may transfer only when all five hold:**

1. `intended_role = 'head_coach'`
2. The team has an owner
3. The accepting user is not already that owner
4. `teams.league_placeholder_owner_id IS NOT NULL` **and equals** `teams.coach_id`
5. The team has no `team_players`, `practice_plans`, `chat_threads` or `games`

The write is a compare-and-set on **both** the owner and the marker, and clears
the marker in the same statement. Claiming is therefore one-way and once-only.

**Ownership must NOT transfer when:**

- The invitation is for an assistant coach → joins as `contributor`
- The team was created through ordinary onboarding (marker `NULL`) → **never
  transferable**, whatever roles its owner holds. *This is the commissioner-who-
  coaches case.*
- The team was already claimed (marker cleared) → joins as `admin`
- The team has activity on it → joins as staff; the data is left alone
- A concurrent request won the compare-and-set → falls through to membership

**Every non-transfer path adds the coach as staff rather than failing**, because
a coach holding a valid invitation should end up on the team either way. The
one hard refusal is a team that no longer exists (410).

**Seasons.** The claiming coach gets a season of their own, created *before*
ownership moves and reused by name. The administrator's holding season is left
in place — it is shared across every team they provisioned, so it is one row per
admin per league season, not per team. **Orphans are prevented rather than
cleaned up**; nothing is ever deleted, because a season could contain real data.

---

## 6. Privacy model

**A league admin can see:** league, seasons, divisions; team names, age groups,
division; coach display names; invitation email, status and timestamps; whether
a coach has been active and when; counts of practice plans; whether chat has been
used at all; seat usage.

**A league admin cannot see:** any chat message, player note, team note, player
trait, scouting entry, opponent analysis, observation, activity-log entry,
prescription, player metric, practice plan title or body, or team memory summary.

Enforced three ways:

1. **By absence in the database.** No policy grants a league member read on
   `teams` or any content table. Those gate on `bc_team_at_least()`, which
   resolves through team ownership and `team_members`; nothing league-shaped
   appears in either. *Verified on a live database*: `no league policy touches a
   team or content table`, `every league policy is SELECT-only`.
2. **By what the reporting route selects.** Manually audited — 11 tables, and
   `user_events` is read as `user_id, created_at` only, **not** `metadata` or
   `event_name`, either of which could carry arbitrary text.
3. **By `verify:league-privacy`**, negative-tested against five bypass classes.

`league_invitations` has RLS enabled and **zero policies** — a table of live
bearer tokens readable by any authenticated user is an account takeover.
*Verified on a live database.*

**Known limits of the verifier:** an allowlisted RPC is trusted (both current
entries touch only league tables and return scalars); it does not analyse
non-route files; and a future migration could still add a policy the checker
would catch only at build time, not at write time.

---

## 7. Entitlement model

`coaches.is_subscribed` means one thing: **this person bought a plan.** Nothing
league-shaped ever writes it — asserted mechanically across all 12 league source
files.

Access resolves to one of four sources, in precedence order: `individual` →
`league` → `team_membership` → `none`. Individual wins so a paying coach is still
described as a customer and keeps access when their league leaves.

**Licence liveness is decided by dates, not the `status` column**, because
nothing sweeps these rows. `ends_at` exclusive, `starts_at` inclusive,
unparseable dates fail closed. Timezone offsets, date-only values and
millisecond boundaries are all pinned by tests.

**Season scope is deliberately not enforced.** `league_licenses.league_season_id`
distinguishes an annual contract from a Spring-only one but is *not* consulted
when granting access — dates bound it instead. Matching seasons would mean a team
whose `league_season_id` is unset or mislabelled silently loses access
mid-season, which looks like a product bug rather than a data problem. Asserted
so it cannot drift.

`assertTeamFeatures(ownerCoachId, teamId?)` tries the owner's own plan first and
returns before any league lookup, so **a paying coach incurs no extra query**.
Asserted against the source, since it is invisible from a return value.

---

## 8. RLS / authz verification

| Check | Method | Result |
|---|---|---|
| `bc_league_rank()` ordering == `LEAGUE_RANK` | SQL parsed and compared pairwise in the test suite | matches |
| App capability inheritance follows the same order | `canManageLeague` matrix | holds |
| No recursive RLS | `bc_in_league_team()` reads `teams`/`team_members`; asserted no policy using it sits on either | holds |
| Helpers are `SECURITY DEFINER` | asserted for all three | holds |
| League membership grants no team/private read | live DB: no league policy outside `league*` | holds |
| All league policies read-only | live DB | 6 policies, all SELECT |
| Writes server-authorized | `verify:authz` + `verify:league-privacy` | every handler guarded |
| Invite tokens not browser-readable | live DB: zero policies on `league_invitations` | holds |
| Seat functions not callable by `authenticated` | live DB `has_function_privilege` | revoked |

---

## 9. Test results

```
22 suites passed, 0 failed
```

League-specific: `test:league-entitlements` **171 passed**,
`test:league-invites` **66 passed**, `verify:league-privacy` **9 route files, 2
allowlisted RPCs**, `test:migration-050` **35 DB assertions + 2 concurrency
races**. Pre-existing regression suites (scorebook, progression, practice
scheduler 517, drill retrieval, drill durations 179, drill video 176, templates,
scouting, SEO, and the four original verifiers) all pass unchanged.

---

## 10. Typecheck delta

Run with the project's own TypeScript **5.9.3** (`./node_modules/.bin/tsc`).
`npx tsc` pulls 6.x and dies on one config error before typechecking anything.

| | Errors |
|---|---|
| Baseline (`8d7eefa`, source only) | **186** |
| Current HEAD (source only) | **186** |
| New | **0** |
| Resolved | 0 |

Normalized error set is **identical**, compared with line numbers stripped since
inserting lines shifts them. `.next/types` is excluded and carries one
pre-existing error (§3, P2-2).

A trap worth restating: **a single syntax error suppresses semantic diagnostics
program-wide**, so a broken file makes tsc report *fewer* errors. Always compare
the set, never the count.

---

## 11. Production build

`npm run build` → **exit 0** with env vars present. All nine league API routes
and both pages compile. Without env vars it fails collecting page data for
`/api/stripe/checkout` on a missing `STRIPE_SECRET_KEY` — pre-existing.

**Build passing is not type safety**: `next.config.js` sets `ignoreBuildErrors`
and `ignoreDuringBuilds`.

---

## 12. Database verification status

| Level | Status |
|---|---|
| **Statically verified** | Yes — 22 suites, 4 original verifiers, privacy verifier, typecheck, build |
| **Offline database tested** | **Yes** — throwaway PostgreSQL 16 cluster, unix socket, `listen_addresses` empty. Migration applies, is idempotent (applied twice), 35 assertions, 12-way and 8-way concurrency races |
| **Staging database tested** | **No** |
| **Production tested** | **No — and nothing was applied to production** |

**What offline testing does not cover.** The bootstrap is a minimal Supabase
stand-in (`auth.users`, `auth.uid()`, three roles). It does **not** prove RLS
behaviour under a genuine authenticated Supabase session, PostgREST's exposure of
the RPCs, Supabase's own `auth.users` triggers, or connection-pooler behaviour
under load. Those need staging.

**Reproduce:** `npm run test:migration-050`.

---

## 13. Remaining risks

1. **RLS has never been evaluated under a real authenticated session.** Structure
   is proven; runtime behaviour is not. Highest remaining risk.
2. **The accept route has never executed end to end.** Its *primitives* are now
   proven against Postgres, but the TypeScript orchestration is not.
3. **Seat release is best-effort.** If `bc_release_league_seat()` itself fails,
   an invitation is left accepted with no team. Logged loudly; needs a human.
4. **`findUserIdByEmail` pages the auth API** (bounded to 2,000 users).
5. **No UI for `/api/admin/leagues`** — provisioning is an API call.
6. **No league picker** — an admin of multiple leagues gets `admin[0]`.
7. **Email delivery does not exist.** By design; the UI shows a copy-link.
8. **`useLeague()` adds one fetch per dashboard load** for every coach.
9. **Allowlisted RPCs are trusted** by the privacy verifier.

---

## 14. GO / NO-GO — staging

### **GO.**

The three P0s are fixed, and the two that could corrupt data — the concurrent
accept and the placeholder heuristic — are now backed by mechanisms proven
against a real database rather than by reasoning. The migration applies, is
idempotent, and leaves existing teams untouched, all demonstrated. The privacy
boundary is enforced in the database and checked mechanically.

**Do first, in order:**

1. Apply `050_league_layer.sql` in the staging SQL editor.
2. Run `050_VERIFY.sql` there — it rolls back, so it is safe against real data.
   Expect 35 passes.
3. Provision one pilot league via `/api/admin/leagues`.
4. Walk one head coach through invite → accept → dashboard on a real device, and
   confirm ownership transferred and the season is readable.
5. Sign in as a commissioner and confirm `/league-admin` shows adoption and
   offers no route to any coach's content.
6. Confirm an ordinary non-league coach sees no change whatsoever.

## 15. GO / NO-GO — production

### **NO-GO.**

Not because a specific defect is known, but because §12 is honest: no RLS policy
in this feature has ever been evaluated by a real authenticated session, and the
acceptance route has never run end to end. Production readiness needs steps 1–6
above to pass on staging first.

Also outstanding and independent of this branch: the **Supabase service-role key
committed to the repo** still needs rotating.
