# What stands between a commit and production

Written after the practice builder spent four days in production rendering
nothing at all. Nothing in the release path could have caught it, because there
was nothing in the release path.

## The path, as it actually is

```
git push origin main
        │
        ▼
GitHub  (no branch protection, no required checks, no review)
        │
        ▼
Vercel  auto-deploys main
        │  Running "npm run build"
        │  > prebuild   → node scripts/release-gate.mjs     ← THE ONLY GATE
        │  > build      → next build
        ▼
production alias moves to the new build
```

There is no pull request step. There is no reviewer. `git push origin main`
deploys, and it always has.

## The one thing that can say no

**`npm run gate`, running as `prebuild`.** If it exits non-zero, `npm run build`
fails, the deployment goes to `ERROR`, and the production alias keeps pointing
at the previous build. Nothing is served from a failed build.

This is not a claim from reading configuration. It is the build log of
`dpl_9rG8ZvyaMrBqiZaSyBfmzhtpCvMN` — commit `f6d5692`, target production,
READY, aliased to `mybenchcoach.com` — with the gate running in full:

```
Detected Next.js version: 14.2.0
Running "npm run build"

> benchcoach@1.0.0 prebuild
> node scripts/release-gate.mjs

Release gate — 7 checks

  environment           ok   27ms
  hook rules            ok   3388ms
  hook order (scanner)  ok   1151ms
  types                 ok   11925ms
  route authorization   ok   39ms
  help content          ok   593ms
  onboarding rules      ok   520ms

✓ Gate passed. This build may deploy.

> benchcoach@1.0.0 build
> next build
```

Vercel runs `npm run build`, so npm runs `prebuild` first. That is the hook the
gate occupies, and the log above is it doing the job in production.

(An earlier version of this document quoted a build from *before* the gate
existed, where `prebuild` was still `verify-env.mjs` alone. That excerpt proved
the mechanism but not the gate. `verify-env.mjs` is now the first check inside
`release-gate.mjs` rather than the whole of it. The run above is **7 checks**;
it is **8** from the next deployment, because `pitch counter` was added after
this log was taken.)

### What the gate checks, and why each one is there

| Check | Why it is a release blocker |
|---|---|
| environment | A missing anon key fails as an unreadable prerender trace. `ADMIN_EMAIL` unset fails *silently*: every `/api/admin/*` answers 404 and nothing says why. |
| hook rules (eslint) | `react-hooks/rules-of-hooks`. The rule that would have caught the four-day outage on the commit that caused it. |
| hook order (scanner) | The indentation scanner. Narrower than eslint and kept deliberately — see below. |
| types | No **new** type errors against `typecheck-baseline.json`. |
| route authorization | Every API handler authorizes its caller. |
| help content | Guides may not name controls that do not exist, claim things the product cannot do, or leak repair instructions to coaches. |
| pitch counter | The pitch guide may not claim enforcement, compliance or safety, and the four display states must match what it says. |
| onboarding rules | A failed query must not be read as "this is a new coach". |

The whole run is about 15 seconds. That is deliberate: a build gate that takes
minutes, or that fails intermittently, gets deleted within a week and takes the
useful checks with it.

### What is deliberately NOT in the gate

**The Chromium suite.** It needs a dev server and a browser binary, and a
Vercel build container has neither. A gate that cannot run is worse than an
honest omission, so it lives in CI instead.

## GitHub Actions — useful, and not a gate

`.github/workflows/checks.yml` runs the gate, the slower test suites, and the
Chromium smoke suite on every push and PR.

**It blocks nothing.** There is no branch protection on this repository, so a
red run does not stop a merge and does not stop a deploy. It is a signal and an
artifact store (it uploads the layout screenshots), nothing more.

### To make it binding

This is a repository settings change, and it is Clint's to make, because it
also changes how *he* pushes:

**The exact required-check names are `gate`, `suites` and `browser`** — nothing
longer. A required status check is matched by the check-run name, which is the
job's `name:` in the workflow, so those three strings are the whole contract.
They were shortened from descriptive sentences for exactly this reason:
renaming a job silently un-requires it, and a required check that no longer
exists blocks every merge instead of none.

Settings needed, in order:

1. GitHub → **Settings → Rules → Rulesets → New branch ruleset**
   (the older Settings → Branches → Branch protection rules works too)
2. **Target branches:** include `main` — "Default branch" is the simplest
   target
3. Enable **Require status checks to pass**
   - add `gate`
   - add `suites`
   - add `browser`
   - also tick **Require branches to be up to date before merging**, or a
     green check on a stale branch can still merge something broken
4. Enable **Require a pull request before merging** as well, unless you want
   the ruleset to apply only to PRs. **Without this, a direct
   `git push origin main` is not covered by required checks** — which is how
   every commit in this repository has been made, so leaving it off means the
   ruleset changes nothing in practice.
5. **Bypass list:** decide deliberately. Adding yourself as a bypass actor
   keeps your own direct pushes working and makes the checks binding only on
   pull requests. Leaving it empty means you must open a PR like anyone else —
   including to fix a broken `main`.

The trade in step 4 is the real decision, and it is yours: binding checks and
a PR for every change, or direct pushes and advisory checks. There is no
configuration that gives both.

Until a ruleset exists, this document should keep saying the workflow is
advisory. Do not describe it as a gate in a delivery report.

## Both hook checks, on purpose

They fail on different things and neither subsumes the other:

- **`scripts/test-hook-order.ts`** is an indentation scanner with no
  dependencies. It finds a hook below a top-level early return — the exact
  shape that shipped. It **cannot see** hooks inside `if` blocks, loops,
  callbacks, `&&` expressions, or early returns it does not recognise. It is a
  blunt instrument that happens to catch the thing that actually happened.
- **`npm run lint:hooks`** is the real rule, with a real parser. It found a
  violation on its first run that the scanner is structurally blind to: four
  hooks below `if (process.env.NODE_ENV === 'production') return null` in
  `app/dev/pathway-harness/page.tsx`. That one never crashed, because NODE_ENV
  is a build-time constant so the branch is consistent within an environment —
  but it was safe by accident, and it is fixed.

`.eslintrc.hooks.cjs` is **one rule**. It is not a house style and it is not
`next lint`. On a codebase this age `next lint` reports hundreds of style
findings on its first run, and a gate that shouts about apostrophes is a gate
somebody switches off — taking the crash-level rule with it. `exhaustive-deps`
is off for the same reason: the repo already carries ~40 considered
`eslint-disable` comments for it, and it is an opinion about convention, where
`rules-of-hooks` is a crash every time for every user.

## The typecheck baseline is now enforced

`scripts/typecheck-baseline.mjs` used to print a number and exit 0. Every
report that said "typecheck 196, unchanged" was a human reading a number.

A total is also not a baseline: fix one error, add another, and the total is
identical. It now compares a **multiset of normalised diagnostic identities**
(`file :: TScode :: message`, with line and column dropped so an added import
does not read as 40 new errors) against `typecheck-baseline.json`.

It fails on:

- any diagnostic not in the baseline, or more of one than recorded
- compiler or configuration errors (`TS5xxx`/`TS6xxx`)
- an incomplete run — killed, out of memory, or no parseable output

That last one matters. During the previous closeout the count "improved" from
196 to 5 because a broken import made `tsc` give up early. A *falling* error
count was the symptom, and the old script reported it as good news.

Diagnostics that have **gone** are reported but do not fail, and the file is
not rewritten automatically. Shrinking the baseline is deliberate:

```
node scripts/typecheck-baseline.mjs --update   # then commit the json
```

The 196 are not a to-do list. Nearly all of them are one thing: the Supabase
client has no generated `Database` types, so `.eq(col, value)` takes `{}` and
rows infer as `never`. Fixing that is its own piece of work.

---

# Production smoke check — for Clint

**I cannot do this one.** This sandbox's network policy answers `403` to
`CONNECT mybenchcoach.com:443` (and to every host not on its allowlist), so
production is unreachable from here. I am not going to route around an access
control to test something.

Everything in the browser suite runs against an in-memory fixture. **No
production data, production RLS, or real authentication has been exercised by
any of it.**

The deployed fix is commit `82a9b95` onwards. Five minutes, signed in as
yourself:

### 1. The practice page renders at all — this is the one that matters

- Open **mybenchcoach.com** → sign in → pick a team → **Practice Plans**
- **Expect:** the page loads, heading "Practice Plans", and either your saved
  plans or the empty state with "Generate Your First Plan".
- **The failure you are looking for:** a blank white area where the page should
  be. If you see that, open the browser console (F12 → Console). "Rendered more
  hooks than during the previous render" means the fix did not take — tell me
  and I will roll back to before `7691c97`.

### 2. The builder still works

- Click **Generate Your First Plan** (or **New Plan → …**)
- Type something into **"Anything specific?"**, tick a focus area
- **Expect:** both stick. Generate a plan and press **"Use this plan"**.

### 3. Help, and that it does not eat your work

- On Practice Plans, click **"Show me how"** (first visit) or
  **"How to use this"**
- **Expect:** a panel slides in from the right, fully on screen, nothing cut off
- Press **Escape**. **Expect:** it closes and nothing else changed.
- Reopen the builder. **Expect:** what you typed is still there.

### 4. On a phone

Same three, on your actual phone. **Expect:** no sideways scrolling, and the
help panel fills the screen rather than hanging off the right edge.

### 5. Nothing tells you to run a migration

If any screen ever says "Run migrations/0xx…" or mentions the Supabase SQL
editor, that is a bug — eleven of those were removed and a test now scans for
them, but tell me if one survived.

Report back on 1 and 2 above all. The rest is polish; that one is whether the
product works.
