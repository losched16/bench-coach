# Deployments

## Why feature branches do not deploy

`vercel.json` sets `git.deploymentEnabled` to `false` for `claude/*` and
`player-development-reports`. Branches not listed — including `main` — still
deploy normally, because unlisted branches default to `true`.

This is not a workaround for a broken build. It records a real constraint:

**There is no staging database.** Preview deployments were pointed at the
production Supabase project until the four env vars below had their Preview
scope removed. That was the right call — a preview branch should not be able to
write to the database real coaches use — but it leaves preview builds with no
database at all:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAIL
```

`scripts/verify-env.mjs` runs as `prebuild` and stops the build with a readable
message. Removing that guard does NOT make preview builds work — it was
measured, not assumed:

```
$ npx next build          # with none of the four set
✓ Compiled successfully
Error: supabaseUrl is required.
Failed to collect page data for /api/admin/verify-links
```

A module-scope `createClient()` fails during page-data collection. So the choice
was between a build that fails with a clear message and one that fails with an
opaque one. Neither is a green check, and weakening the guard would have traded
the good error for the bad one.

Disabling the deployment is the honest third option: a branch that cannot be
built is not built, and no red check is produced claiming otherwise.

## What this costs

A feature branch gets no preview URL, so the only pre-merge signal is the local
suite and `npm run build`. That is a real loss and it is why this is temporary.

## How to undo it

When a staging Supabase project exists:

1. Create it, apply `migrations/000_baseline.sql` then the pending migrations.
2. In Vercel → Settings → Environment Variables, add the four variables above
   scoped to **Preview only**, pointing at the staging project.
3. Delete the `git` block from `vercel.json`.
4. Push a branch and confirm the preview builds and points at staging —
   `verify:env` prints the resolved project ref on every build, so read it.

`docs/ENVIRONMENTS.md` has the full variable list and which value belongs where.

## Production

`main` deploys to production automatically and is unaffected by the block above.
`main` is not listed in `deploymentEnabled`, and unlisted branches default to
`true`.
