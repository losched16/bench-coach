# The schema baseline

How a brand-new Supabase project becomes a working BenchCoach database, why it
cannot today, and what has to be captured to close that.

Run `npm run verify:bootstrap` to reproduce every number in this document
against a throwaway PostgreSQL cluster. It touches no network and no real
database.

---

## Where things actually stand

I previously reported that "no migration creates `coaches`, `teams`,
`players`". That was true of `migrations/` and misleading about the repository.
**`supabase-schema.sql` at the repo root creates 14 of them**, with 28 policies
and 13 indexes. It is referenced by `README.md`, `SETUP_GUIDE.md` and
`scripts/test-migration-050.sh`, and `docs/drill-audit.md` had already recorded
that it is incomplete. The correct statement is narrower and more useful:

| Source | Tables it creates |
|---|---|
| `supabase-schema.sql` | 14 |
| `migrations/001…051` | 30 |
| **nothing in the repository** | **24** |
| `bwc_*` — a different application | 11 |
| | **79 in production** |

Bootstrapping from what exists today produces **28 of 79 tables**, and **35 of
48 migrations fail**, almost all on `relation "drill_resources" does not exist`
or `relation "games" does not exist`. Two independent methods — static analysis
of the SQL, and an actual apply against a real cluster — agree on the same 24.

### The 24 objects the baseline must supply

```
admin_alerts              game_notes            player_milestones
admin_daily_active_users  game_pitch_counts     player_playbooks
admin_feature_usage       games                 player_season_batting
admin_user_activity       lineup_assignments    playbook_templates
drill_resources           player_game_stats     position_eligibility
game_lineups              player_journal_entries practice_templates
saved_drills              seo_pages             swing_analyses
team_invitations          team_members          user_events
```

Three of those (`admin_daily_active_users`, `admin_feature_usage`,
`admin_user_activity`) are **views**, not tables — PostgREST reports no
required columns for them and `app/api/admin/route.ts` reads all three.
`admin_user_activity` exposes `display_name`, `stripe_customer_id` and
per-user activity counts across every account, so its grants matter more than
most.

A further 16 tables are missing only because the migration that would create
them could not run. They resolve themselves once the baseline exists.

---

## Decision: squash (Approach C)

**`000_baseline.sql` is a current-state schema capture, and `001…051` are
archived rather than replayed.** New databases start from the baseline plus
whatever is numbered above the cutover.

### Why not Approach A (current-state baseline, then run 001–051 after it)

This is the same capture, but keeps the historical migrations in the run
sequence behind a cutover marker. It fails for a concrete reason rather than an
aesthetic one: three of those files change **rows**, not schema.
`046_taxonomy_coverage.sql` inserts taxonomy and mapping rows,
`047_drill_durations.sql` populates `est_duration_minutes`, and
`048_normalize_operational_metadata.sql` rewrites category strings. A
current-state dump already contains their effects. Re-running them against a
database that has them is a second application of a data transformation, and
`048` in particular is not idempotent in the direction that matters — it
normalises values, and normalising already-normalised values is only safe by
accident.

Approach A would therefore require auditing all 48 files for double-apply
safety. That is more work than the squash, and the work is invisible: a file
that double-applies safely today can stop doing so when someone edits it.

### Why not Approach B (reconstruct the pre-migration baseline)

Approach B strips the migrations' effects from the dump so that `000 + 001…052`
reproduces production. It reconstructs a state that **never existed in source
control** — the 24 tables were made in the dashboard, at unknown times,
interleaved with the migrations. There is no correct answer to "what did the
schema look like before 001", only a plausible one, and a plausible baseline is
worse than an honest current-state one because it looks authoritative.

It also buys nothing. Nobody needs to replay 2024's schema history. What
everyone needs is a database that matches production.

### Why the squash

1. The migration chain is **already unreproducible**. `001` fails on its first
   statement today. Approach B preserves a history that does not run; the
   squash admits it does not run and replaces it with something that does.
2. **One file to review.** This task is a security review of the schema.
   Reviewing one baseline's RLS is tractable. Reviewing a baseline plus 48
   files that each partially amend it is not, and the review is the point.
3. **Idempotence stops being load-bearing.** A new database runs the baseline
   once.

### The cutover, stated exactly

- `migrations/000_baseline.sql` — production's schema as of the capture date,
  which includes the effects of every migration **that has been applied to
  production**.
- Migrations **037, 039 and 051 are NOT applied to production**, so their
  effects are *not* in the capture. They remain live migrations and run after
  the baseline.
- `001`–`036`, `038`, `040`–`050` move to `migrations/archive/` with a README
  saying they are historical and already inside the baseline. They are not
  deleted — they are the record of why the schema is shaped as it is, and
  several carry the only written explanation of a design decision.
- The next new migration is `052`.

**Consequence to accept deliberately:** a staging database built this way is
production *plus* 037, 039 and 051. That is what staging is for, and it is why
League E2E can test `bc_provision_league` before production has it. It also
means `npm run db:report -- --compare` will show staging as having columns
production lacks. Extra columns are reported as informational; missing ones
fail. That is the right way round.

---

## Capture: the corrected command

**Do not use `--no-privileges`.** I gave that flag in the previous report and
it is wrong, for a specific reason.

`--no-privileges` omits GRANTs *and* REVOKEs. The GRANTs are mostly
recoverable — Supabase sets `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
ALL ON TABLES TO anon, authenticated, service_role`, so tables created in a new
project pick those up automatically. The REVOKEs are not.
`050_league_layer.sql` deliberately revokes EXECUTE on `bc_claim_league_seat`
from `anon` and `authenticated`, and its own comment says why:

> a function left EXECUTE-able by `authenticated` is a hole straight through
> every policy in this file. `bc_claim_league_seat()` in particular can flip an
> invitation to accepted.

A baseline dumped `--no-privileges` and applied to staging restores the
function and loses the revoke. That is the exact failure the Definition of Done
names — silently inheriting an unsafe rule, except worse, because staging would
be *less* safe than production.

```bash
# From a machine that can reach Supabase on 5432.
# Connection string: Supabase → Project Settings → Database → Connection string
pg_dump --schema-only --no-owner --schema=public \
        "$PRODUCTION_DATABASE_URL" \
        > migrations/000_baseline.sql

npm run inspect:baseline -- migrations/000_baseline.sql
```

`--no-owner` stays. Ownership is `postgres` or `supabase_admin` depending on
how an object was created, it differs per project, and reproducing it is both
impossible and pointless.

`--schema=public` already excludes `auth`, `storage`, `graphql`, `realtime`,
`vault` and `extensions`, which is the whole of Step 7's concern. What it does
not exclude is anything a Supabase feature created *inside* `public`; the
inspector lists anything with a platform-looking name so a human decides.

### One role will not exist in a fresh project

`benchcoach_seo`, from `045_seo_editor_role.sql` — the scoped role that can
only touch `seo_pages`. A privileges-carrying dump names it in GRANT
statements, and a GRANT to a nonexistent role aborts. Either create the role in
staging first (run `045` before the baseline) or strip those three statements.
`npm run inspect:baseline` prints every role the file names and flags the
non-standard ones, so this is checked rather than remembered.

---

## Canonical bootstrap sequence

For a brand-new Supabase staging project, in the SQL editor:

1. `migrations/045_seo_editor_role.sql` — creates `benchcoach_seo`, which the
   baseline's GRANTs reference. (Only the role-creation part is needed; the
   rest is idempotent.)
2. `migrations/000_baseline.sql`
3. `migrations/037_journal_into_entries.sql` — not in production, not in the baseline
4. `migrations/039_practice_schedule.sql` — same
5. `migrations/051_provision_league_atomically.sql` — same; **League E2E needs this**

Then:

```
BENCHCOACH_ENV=staging NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
  npm run db:report -- --compare
BENCHCOACH_ENV=staging npm run staging:seed
```

Prove it locally first, against a throwaway cluster, before touching a real
project:

```
npm run verify:bootstrap
```

---

## Security findings so far

Everything below is from the **13 migrations that do apply** plus
`supabase-schema.sql`, verified against a real PostgreSQL cluster — not read
off the page. The policies on the 24 missing objects, which include
`drill_resources`, `games`, `team_members` and `seo_pages`, **cannot be
reviewed until the dump exists.** Those are the ones guarding customer data,
so this audit is a genuine partial.

### CRITICAL — verify in the dump before anything else

**Is RLS actually enabled on the six league tables in production?**

In the reconstructed database, `leagues`, `league_members`, `league_licenses`,
`league_invitations`, `league_divisions` and `league_seasons` all have **RLS
off**. Here that is an artifact: `050_league_layer.sql` creates the tables
first and enables RLS later, and it aborted in between on
`relation "team_members" does not exist`.

But the same partial-apply is possible in the Supabase SQL editor, where a
migration is pasted and runs statement by statement without a wrapping
transaction. If `050` ever stopped early in production, those six tables have
RLS off — and with Supabase's default grants, RLS off means **readable by
`anon`**. They are empty today, which is the only reason this is not already a
disclosure.

`npm run db:report` cannot see this; PostgREST does not expose RLS state. The
first thing to check in `000_baseline.sql` is six `ALTER TABLE … ENABLE ROW
LEVEL SECURITY` lines and six policies.

**Separately: `050_league_layer.sql` should be wrapped in `BEGIN; … COMMIT;`.**
A migration that can leave tables created and unprotected is a migration that
should not be able to stop halfway.

### HIGH (conditional) — 9 of 10 SECURITY DEFINER functions do not pin `search_path`

| Function | Pins `search_path` |
|---|---|
| `bc_provision_league` (051) | yes — `public, auth` |
| `bc_claim_league_seat` | **no** |
| `bc_release_league_seat` | **no** |
| `bc_league_role`, `bc_league_at_least` | **no** |
| `bc_team_role`, `bc_team_at_least` | **no** |
| `game_notes_to_observation` | **no** |
| `mark_opponent_analysis_stale`, `…_by_player` | **no** |

This is Supabase's `function_search_path_mutable` lint. A SECURITY DEFINER
function resolves unqualified names — `teams`, `coaches`, `auth.uid()` —
against the **caller's** `search_path`. If a caller can create objects in a
schema that resolves earlier, they choose what `teams` means inside a function
running with the definer's rights.

Conditional because it needs `CREATE` on some schema in the search path.
Supabase revoked `CREATE ON SCHEMA public FROM PUBLIC` for projects created
after PostgreSQL 15; older projects did not. **Check
`has_schema_privilege('authenticated', 'public', 'CREATE')` in the dump.** If
it is true, this moves to Critical.

The fix is one clause per function and changes no behaviour:
`SET search_path = public, auth`. Not applied here — this task was to establish
what the functions currently do.

### Looks correct

**The `bc_*` authorization helpers.** All eight in `034_staff_access.sql` and
all four league equivalents key off `auth.uid()` internally. None takes a user
id as a parameter, so a caller supplying an arbitrary `p_team` learns only
their own role on it. There is no impersonation vector. `bc_rank` is
`IMMUTABLE` and not SECURITY DEFINER, which is right for a pure function.

**The two league mutations are properly revoked.** Verified against a real
cluster: `bc_claim_league_seat` and `bc_release_league_seat` are EXECUTE-able
by `service_role` only. `bc_provision_league` likewise, asserted by
`scripts/test-migration-051.sh`.

**Seven SECURITY DEFINER functions are EXECUTE-able by `anon` and
`authenticated`, and this is correct for all seven.** Four
(`bc_team_role`, `bc_team_at_least`, `bc_league_role`, `bc_league_at_least`)
are *required* to be: policies call them, and a policy evaluated as
`authenticated` needs EXECUTE on what it calls. The other three
(`game_notes_to_observation`, `mark_opponent_analysis_stale`,
`mark_opponent_analysis_stale_by_player`) are trigger functions; PostgreSQL
refuses a direct call with *"trigger functions can only be called as
triggers"*, so the grant is not reachable.

**The 40 reconstructible policies hold up.** Every one of them references
`auth.uid()` — checked against the full policy body, not the first line — and
none uses `USING (true)`. The ownership chain is consistent throughout:
`team_id → teams.coach_id → coaches.user_id = auth.uid()`.

**The two `Anyone can read …` policies are correctly scoped.** On
`metric_types` and `pitch_count_rules`, both read
`USING (coach_id IS NULL OR coach_id IN (… WHERE coaches.user_id = auth.uid()))`
— system reference rows are public, a coach's own customisations are not. That
is the right shape for seeded reference data.

**16 policies have no `FOR` clause, which makes them `ALL` with a `USING` and
no `WITH CHECK`.** I flagged that as a possible insert hole and it is not one:
PostgreSQL uses the `USING` expression as the `WITH CHECK` when `WITH CHECK` is
omitted, so the same ownership test governs inserts and updated rows. No action.

### Review

- **Two authorization models coexist on `teams` and `team_members`, and they
  OR together.** `supabase-schema.sql` grants the *owner*
  (`coaches.user_id = auth.uid()`); `034_staff_access.sql` adds `bc_*` policies
  granting *members at a rank* — and it drops only its own `bc_`-prefixed
  policies, not the originals. Policies are permissive, so the effective
  permission is the union. That is additive and correct, but it means reading
  either set alone understates who has access. Worth consolidating once the
  full policy list is visible.
- `game_notes_to_observation` is redefined by `026_fix_game_note_mirror.sql`
  after `016` creates it. The baseline captures only the final form, which is
  correct, but means `026`'s explanation lives only in the archive.

---

## `bwc_*`: not BenchCoach

Eleven tables — I said 14 previously and was wrong; the count is 11.

```
bwc_build_log        bwc_experiments        bwc_roadmap_milestones  bwc_sync_logs
bwc_businesses       bwc_metric_snapshots   bwc_settings            bwc_timeline_events
bwc_content_activity bwc_metric_sources     bwc_subscribers
```

**Determination: a different application. Exclude from the baseline.**

Evidence:

- **Shape.** `bwc_businesses` has `slug, name, type, stage, the_bet,
  current_focus, next_milestone, is_distribution`. `bwc_experiments` has
  `hypothesis, primary_metric, baseline, target, outcome, lesson`.
  `bwc_build_log` has `what_happened, why_it_matters, lesson,
  content_potential`. This is a build-in-public portfolio tracker spanning
  multiple businesses. BenchCoach is one product and has no concept of a
  "business".
- **No foreign keys into BenchCoach.** Every `business_id` points at
  `bwc_businesses`.
- **Zero references in the application.** No route, component, library or
  migration mentions them. The only occurrences in this repository are in files
  generated during this audit.
- **`bwc_subscribers` holds `email`, `resend_contact_id`, `unsubscribe_token`.**
  A newsletter list. Including it would put a table designed to hold real email
  addresses into a staging environment — the precise thing the seed policy
  exists to prevent.

They stay in production, untouched. They do not enter source control.

`admin_*` is the opposite call: four objects, all read by
`app/api/admin/route.ts`, all BenchCoach, all in the baseline.

---

## What is still unknown

Not softening this: the audit above covers what could be reconstructed, and the
most security-relevant objects are exactly the ones that could not be.

- policies on `drill_resources`, `games`, `team_members`, `team_invitations`,
  `seo_pages`, `user_events` and the twelve player/game tables
- grants on the three `admin_*` views, particularly `admin_user_activity`
- whether `authenticated` holds `CREATE` on `public`
- whether RLS is genuinely on for the six league tables in production
- triggers, constraints and defaults on all 24 missing objects
- anything Supabase created inside `public`

All of it is answered by the dump, and none of it before.
