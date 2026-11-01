# Speed program: release readiness

**Status: not launched, off by default. PR #33 stays a draft.**

## Evidence

| Check | Result |
|---|---|
| Unit and static route checks (`test:speed-program`) | pass |
| Postgres 16, stand-in schema (`test:migration-081`) | pass |
| Postgres 16 on the **production schema export** with Supabase's real default grants, the real `bc_*` helpers and real policies (`test:migration-081-baseline`, 89 checks) | pass |
| Flag on, full flow in Chromium (`test:speed-program-e2e`) | 56 pass |
| Flag off, nothing exists (`test:speed-program-flag-off`) | 14 pass |
| Release gate | pass |
| CI on the PR (`gate`, `suites`, `browser`) | all three pass at commit `bb2e12d`; re-check after any later push |

### What "production-like" means here, and what it does not

Production is not reachable from this environment, and the instruction was not to
modify production data. So the authorization test runs against a **throwaway local
Postgres loaded with `migrations/000_baseline.sql`** (the committed export of
production's schema, functions and policies), a Supabase-style `auth.uid()` that reads
the request JWT claim, the `authenticated` role without RLS bypass and `service_role`
with it, and Supabase's default privileges (`ALL` on every new table to `anon`,
`authenticated`, `service_role`).

That test found a real gap in the first version of 081: Supabase's default grants gave
`anon` and `authenticated` DELETE/TRUNCATE on the new tables. RLS and the append-only
triggers already blocked misuse, but the grants contradicted the design, so 081 now
revokes everything and grants only what is needed (fixed and retested).

It does **not** prove production's live state. `scripts/speed-program/verify-prod-readonly.sql`
does that part: every statement is a read-only `SELECT` (a test checks it contains no
write statement), to be run in the Supabase SQL editor before applying 081 (PART 1:
helpers and tables exist, `bc_rank` knows role words, which mapped library drills are
present) and after (PART 2: five tables, RLS on, no capability words in policies,
grants as designed, triggers present). I have not run it against production.

## The four inherited pitch-counter failures

**Do they affect release confidence? Not for the speed program or the Academy, and
they were real.**

- They fail identically on a clean `origin/main` in this sandbox (checked), and the
  browser job passes in GitHub CI. They are not caused by either PR.
- Cause: the count route read the count and wrote count+1 with no condition, so two
  taps in flight both wrote the same value and one pitch was lost. The failures were
  always off by exactly one. That is a genuine undercount risk on a youth-arm tool,
  not only a flaky test.
- Fix: PR #34, separate from this work. With it the whole browser suite is 236 pass,
  0 fail. Without it, 232 pass and 4 fail here.
- I did not write a dedicated concurrency test; the evidence is the before/after run.

## Blockers before the flag is turned on

1. A coach approves or edits Foundation and Advanced (`COACH-REVIEW.md`), the indoor
   falling start (`INDOOR-FALLING-START.md`) and the two drill drafts (`DRILL-DRAFTS.md`).
2. Apply 081 to the **QA** database; run the read-only verify SQL.
3. A real-device pass with the checklist in `MOBILE-QA.md`, on a test team and a
   made-up player, never a real child's record. No preview exists; see that file.
4. Every video reference reviewed or removed.
5. ~~Decide whether timed results should also be written to `player_metrics`.~~ **Deferred by decision; not built, not a blocker.**

## Known limits

- Flag off, the program page returns the app's not-found page. In the dev server the
  HTTP status of that page is 200 (the page body is the 404 view), while every API
  route returns a true 404. I did not test the production build's status code.
- The browser tests use an in-memory stand-in for Supabase. They prove the app's
  behaviour, not production data or RLS.
