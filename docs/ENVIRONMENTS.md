# Environments

There is one BenchCoach database and it holds real coaches, real teams and real
children's names. Everything below exists because testing the league layer
means creating leagues, inviting coaches and accepting invitations, and doing
that in the only database that exists means doing it in that one.

This document says what is now in place, what is not, and — the part that
matters — the one thing that blocks a staging environment from existing at all.

---

## The blocker: the repository cannot build this database

**No migration in this repository creates `coaches`, `teams`, `players`,
`drill_resources`, `seo_pages`, `playbook_templates`, `practice_sessions`,
`practice_plans`, `chat_threads`, `chat_messages`, `games` or `seasons`.**

Production has 79 tables. The migrations in `migrations/` account for about 25
of them, and every one of those 25 is *additive* — `001_prescription_engine.sql`
opens by `ALTER TABLE drill_resources`, a table that does not exist on an empty
database. The core schema was created by hand in the Supabase dashboard over
the life of the project and exists nowhere in version control.

So the obvious plan — "create a new Supabase project, run the migrations, done"
— does not work. It fails on the first file.

Verify it yourself, read-only, against any database:

```
npm run db:report
```

That prints which migrations a database looks to have (inferred from the objects
they create; this project has no migrations table, so it is evidence rather than
a ledger), and lists the tables no migration accounts for.

### What closes it

A baseline. `migrations/000_baseline.sql`, containing the schema production
actually has, so that an empty project plus `000` plus `001…052` reproduces it.

It has to be captured with `pg_dump --schema-only`, and **that cannot be done
from the Claude Code sandbox** — outbound Postgres on 5432 and 6543 is blocked,
which is also why every migration in this project is applied by pasting into the
Supabase SQL editor. It needs a machine with direct database access:

```bash
# From a machine that can reach Supabase on 5432.
# Connection string: Supabase → Project Settings → Database → Connection string
pg_dump --schema-only --no-owner --no-privileges \
        --schema=public "$PRODUCTION_DATABASE_URL" \
        > migrations/000_baseline.sql
```

Then read it before committing it. `--schema-only` emits no rows, but it does
emit every policy, trigger, index, constraint and grant — which is the point,
and is also why it should be reviewed rather than pasted in blind.

`docs/schema/expected-surface.json` is a partial stand-in recorded in the
meantime: every table, view, column, type and exposed function, read from
production's PostgREST schema. It is enough to answer "does staging have the
same shape as production":

```
npm run db:report -- --compare
```

It is **not** enough to answer "is staging as secure as production", because
PostgREST does not expose RLS policies, indexes, triggers, constraints, grants,
sequences, storage buckets, or anything in the `auth` and `storage` schemas.
A staging project that passes `--compare` has the right shape and unknown
security. Do not read a green `--compare` as more than it says.

---

## The environment model

Three environments, and one rule.

| | Supabase project | `BENCHCOACH_ENV` | Who uses it |
|---|---|---|---|
| **local** | a local Supabase, or none | `local` | one developer, one machine |
| **staging** | a separate Supabase project | `staging` | League E2E testing |
| **production** | `chdpqsumqospnaztvfqe` | `production` | real coaches |

**Ambiguity is production.** If a script cannot identify the database it is
pointed at, it treats it as the live one and refuses to write. A default of
"probably staging" is how a test suite eventually truncates a real table.

Two consequences worth stating plainly:

- **The URL beats the label.** `BENCHCOACH_ENV=staging` pointed at the
  production project resolves to *production*. The data does not care what the
  variable says. The reason is printed, so nobody is left believing they are on
  staging.
- **An unlabelled hosted project is production.** Not because it is, but
  because nothing has established that it is not.

The model lives in two files that are deliberately not imported into each
other — `lib/env.ts` for the app, `scripts/lib/env-guard.mjs` for scripts that
run as plain `node` on a laptop. `npm run verify:env-safety` fails the build if
they disagree, and `npm run test:env-safety` runs the same cases through both.

### Writing to production

Any script that can write prints its target first and refuses production unless
the caller **names the project**:

```
BENCHCOACH_ALLOW_PRODUCTION_WRITE=chdpqsumqospnaztvfqe npm run <script>
```

A boolean override gets pasted into a shell profile once and then authorises
every future run, including the ones pointed somewhere unexpected. Naming the
ref means an override left over from staging work does not apply here, and an
ambiguous target — which has no ref to name — cannot be authorised at all.

`npm run staging:seed` has no override at all. Seeding upserts 600 rows over
whatever drill library is there, and nobody should be one typo away from doing
that to production.

---

## Setting up staging

### 1. Create the project

Supabase → New project. Same region as production. Note the project ref.

### 2. Build the schema

Until `000_baseline.sql` exists (above), this is the manual step. In the
Supabase SQL editor, in order:

1. `migrations/000_baseline.sql` — **does not exist yet; see the blocker**
2. `001` … `049` in numeric order
3. `050_league_layer.sql`
4. `051_provision_league_atomically.sql`

Then check the shape:

```
BENCHCOACH_ENV=staging NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co \
  npm run db:report -- --compare
```

### 3. Seed reference data

```
BENCHCOACH_ENV=staging npm run staging:seed
```

49 problems, 206 drills, 348 drill↔problem mappings, from
`pilot/reference/*.json`.

**Nothing else is seeded, and that is deliberate.** No coaches, teams, players,
notes, scouting entries or games. The instinct on a new staging database is to
copy production so it "looks real", and it is the wrong instinct: those rows are
the private records of real families, and staging is by definition the
environment with looser access, fewer eyes on it, and credentials pasted into
more places. A staging database with real player notes in it is a breach
waiting for one misconfigured policy.

League E2E testing does not need them. A league, a commissioner, a division and
an invited coach are all created *through the product* — that is the flow being
tested. Seeding them would test the seeding.

The seed refuses to run if the export ever grows a column that identifies a
person, checked every run rather than once.

### 4. Create the staging admin account

The provisioning UI at `/admin/leagues` is gated by `requireAdmin()`, which
compares the signed-in email against `ADMIN_EMAIL`. There is no seed for this
because the account has to exist in Supabase Auth.

1. Sign up through the staging app at `/auth/signup` with an address you
   control. A plus-address works and keeps it distinguishable —
   `you+staging@example.com`.
2. Confirm the email (Supabase → Authentication → Users, or the confirmation
   mail).
3. Set `ADMIN_EMAIL` to that address in the staging environment, exactly, in
   lowercase.
4. Redeploy. `requireAdmin()` reads it at request time, but Vercel only injects
   a changed variable on a new deployment.

If `/admin/leagues` returns 404, that is almost always this: the route is
denying you, not missing. `npm run verify:env` says whether `ADMIN_EMAIL` is set
at all.

---

## Vercel

### The thing to check first

**Vercel Preview deployments inherit whatever an environment variable is set to
for the Preview scope, and the default when a variable is added without
choosing scopes is all three.** If `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set for Production, Preview *and* Development —
which is the default and is very likely the current state — then **every
preview deployment of every branch is running against the production database
with a service-role key.**

That is not a hypothetical for this repository: the league provisioning UI is on
a branch right now, and a preview of that branch would provision leagues into
production.

Check it: Vercel → Project → Settings → Environment Variables. Each variable
shows which environments it applies to.

### Target layout

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | production ref | **staging ref** | staging or local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production | **staging** | staging or local |
| `SUPABASE_SERVICE_ROLE_KEY` | production | **staging** | staging or local |
| `BENCHCOACH_ENV` | `production` | `staging` | `local` |
| `ADMIN_EMAIL` | real admin | staging admin | staging admin |
| `NEXT_PUBLIC_APP_URL` | live domain | the branch alias URL (see below) | `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | live key | live key or unset | unset |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | live keys | **test keys or unset** | unset |
| `CRON_SECRET` | set | unset | unset |

Two notes on that table:

- **Stripe on Preview must not be live keys.** Nothing in league testing reaches
  checkout — a league-sponsored coach is entitled by their licence and never
  sees Stripe — so unset is the honest setting, and it fails closed.
- **`ANTHROPIC_API_KEY` is a cost, not a risk.** Preview traffic against it is
  billed but touches no customer data.
- **`NEXT_PUBLIC_APP_URL` must be set on Preview, or invitations break.** The
  fallback in `app/api/league-admin/invitations/route.ts` is
  `http://localhost:3000` — not a relative path — so an invitation generated on
  a preview deploy without it sends the recipient to their own machine. Vercel's
  per-deploy URL changes every push, but the **branch alias** does not:
  `<project>-git-<branch>-<team>.vercel.app`. Use that.

### The build now stops on a missing variable

`npm run build` runs `verify:env` first (`prebuild`). It fails, with the
variable named and a sentence on what its absence breaks, rather than letting
the deploy succeed into a broken state. `ADMIN_EMAIL` is in that list precisely
because its absence is silent today: `requireAdmin()` denies everyone, every
`/api/admin/*` route answers 404, and the admin page looks like a bug.

If a Vercel deploy starts failing after this change, read the message — it names
the variable and the scope to set it in.

---

## Testing RLS properly

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security on every table. **Any
test that uses it proves nothing about authorization** — it proves the data
exists, which was never in question.

Testing the league layer's isolation means real Supabase auth tokens:

1. Create two coach accounts in staging through `/auth/signup`, in different
   leagues.
2. Sign in as each and capture the access token
   (`supabase.auth.getSession()`, or the `sb-<ref>-auth-token` cookie).
3. Query with the **anon** key plus that token in `Authorization: Bearer`.
   That is the path a browser takes, and the one the policies apply to.
4. Assert on absence: coach A must get **zero rows** for coach B's team,
   players, notes and scouting entries — not an error. RLS filters; it does not
   raise. A test asserting a 403 will pass for the wrong reason and keep passing
   after the policy is dropped.

The cases worth writing first, because they are the ones the league layer newly
makes possible:

- a coach in league A reading a team in league B → 0 rows
- a commissioner of league A reading players in league B → 0 rows
- **a commissioner reading player-level records in their _own_ league** →
  0 rows for anything a league is not entitled to see. A commissioner
  administers a league; they are not a coach of its children.
- an unauthenticated request to any league table → 0 rows
- a coach whose league licence is `expired` → no sponsored entitlement
- `bc_provision_league` called with an `authenticated` token → denied
  (`051` revokes it from `anon` and `authenticated`;
  `scripts/test-migration-051.sh` asserts this against real Postgres)

`npm run verify:league-privacy` is a static check over the source and is
complementary, not a substitute — it cannot see a policy.

---

## League E2E readiness checklist

Against staging, in order. Each line is a thing that has failed for a real
reason at some point.

- [ ] `npm run verify:env` — all four required variables set
- [ ] `npm run db:report -- --compare` — shape matches production
- [ ] `bc_provision_league` present (051 applied) — `db:report` reports it
- [ ] `npm run staging:seed -- --check` — 49 / 206 / 348
- [ ] staging admin account exists, confirmed, and `ADMIN_EMAIL` matches it
- [ ] `/admin/leagues` loads rather than 404s
- [ ] provision a league → league + owner + licence all created (all three, or
      the league is not usable; `051` makes it atomic)
- [ ] `/league-admin` loads for the owner
- [ ] create a division and a season
- [ ] invite a coach → the invitation link resolves for someone who is not you
      (`NEXT_PUBLIC_APP_URL` unset makes it `http://localhost:3000/...`, which
      works on your machine and nowhere else — the failure mode that looks like
      success)
- [ ] accept as a second account → coach lands in the league, seat claimed
- [ ] the sponsored coach's entitlement comes from the licence, with no Stripe
      subscription
- [ ] licence `coach_limit` refuses the seat past the limit
- [ ] set the licence to `expired` → entitlement drops
- [ ] the RLS cases above, with real tokens

---

## Promoting to production

1. Merge to `main`. Vercel builds; `prebuild` fails loudly on a missing
   variable rather than deploying a broken configuration.
2. Apply the migrations **in the Supabase SQL editor**, in numeric order,
   before or with the deploy — not after. Every migration in this project is
   additive and idempotent, so the app tolerates running ahead of them: league
   queries return `data: null` through supabase-js rather than throwing, and
   the league surfaces stay hidden. It does not tolerate them running behind a
   feature that needs them.
3. `npm run db:report` against production and confirm the migration you applied
   now reads as applied.
4. Smoke-test the flow you changed, signed in as a real account.

**Currently unapplied in production** (from `db:report`, September 2026):

| Migration | State |
|---|---|
| `037_journal_into_entries` | not applied — `entries.legacy_journal_id` absent |
| `039_practice_schedule` | not applied — `practice_plans.scheduled_for` absent |
| `051_provision_league_atomically` | not applied — `bc_provision_league` absent |

`046`, `047` and `048` change rows rather than schema, so `db:report` cannot see
them; their row counts (49 problems, 206 drills, 348 mappings) match the
expected post-migration state.

---

## Outstanding

**Rotate the production `service_role` key.** It was committed to this
repository, is still live (expires 2036), and removing the literal from
`scripts/update-playbook-templates.js` — done in this branch — does not remove
it from git history. `docs/audits/security-secret-followup.md` has the ordered
rotation steps; note in particular that the key configured in the Claude Code
cloud environment *is* the leaked one, so it has to be updated in the same pass
or that environment breaks.

**Capture `000_baseline.sql`.** Nothing above produces a real staging
environment until this exists.

**14 `bwc_*` tables** share this database and belong to something other than
BenchCoach. They are outside the scope of this work, but they are worth knowing
about before anyone reasons about "the BenchCoach database" as a single thing.
