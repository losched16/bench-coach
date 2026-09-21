# Phase 2J — Release Safeguards, then Contextual Help Expansion

Two separate pieces of work, reported separately because they answer different
questions. The first is about whether a broken change can reach coaches. The
second is about five modules getting guidance.

---

# PART 1 — RELEASE SAFEGUARDS

## What the release path actually was

Inspected rather than assumed:

- **No `.github/workflows`.** No CI of any kind.
- **No git hooks.** No `.husky`, no `core.hooksPath`.
- **No branch protection**, no required review, no required checks.
- **`next.config.js` sets `typescript.ignoreBuildErrors: true` and
  `eslint.ignoreDuringBuilds: true`**, so the build tolerates almost anything.
- **No eslint config existed at all**, so `npm run lint` (`next lint`) had
  never had anything to run.
- **`vercel.json` disables deploys for `claude/*` branches**, and `main`
  auto-deploys.

So: `git push origin main` → Vercel → production. Nothing in between. "We have
tests" meant "somebody might run them", and in the case of the practice page
nobody did for four days.

## What blocks a failing change now

**One thing, and it is real: `npm run gate`, running as `prebuild`.**

Vercel runs `npm run build`, so npm runs `prebuild` first. A non-zero exit
fails the build, the deployment goes to `ERROR`, and the production alias stays
on the previous build.

This is not inferred from configuration. It is in the build log of the
deployment that carries this change, `dpl_G9Jke1eJBdX9WvS6V5tnkgYnmM1m`:

```
Running "npm run build"
> benchcoach@1.0.0 prebuild
> node scripts/release-gate.mjs

Release gate — 7 checks

  environment           ok   29ms
  hook rules            ok   3251ms
  ...
```

Seven checks, ~12 seconds: environment, hook rules (eslint), hook order
(scanner), types, route authorization, help content, onboarding rules.

### What is NOT a gate, stated plainly

**`.github/workflows/checks.yml` blocks nothing.** It runs the gate, the slower
suites and the Chromium smoke suite on every push and PR, and uploads the
layout screenshots — but with no branch protection, a red run stops neither a
merge nor a deploy. It is a signal.

Making it binding is a repository settings change, and it is **Clint's to
make**, because it also governs his own direct pushes. The exact steps are in
`docs/release-gates.md`. Until that is done, nothing should describe that
workflow as a gate.

The Chromium suite is deliberately **not** in the build gate: a Vercel build
container has no browser and no dev server, and a gate that cannot run is worse
than an honest omission.

## ESLint — one rule, on purpose

`.eslintrc.hooks.cjs` enables `react-hooks/rules-of-hooks` and nothing else.
`exhaustive-deps` is explicitly off.

This is not a repository-wide cleanup and was kept away from becoming one.
`next lint` on a codebase this age reports hundreds of style findings on its
first run; a gate that shouts about apostrophes gets switched off, and the
crash-level rule goes with it. `rules-of-hooks` is different in kind — breaking
it is a runtime crash, every time, for every user.

**Verified against the bug that shipped:** run on the pre-fix practice page it
reports `React Hook "useEffect" is called conditionally` at line 1014.

**It found one more on its first run**, which the indentation scanner is
structurally blind to: four hooks below
`if (process.env.NODE_ENV === 'production') return null` in
`app/dev/pathway-harness/page.tsx`. That never crashed — `NODE_ENV` is a
build-time constant, so the branch is consistent within an environment — but it
was safe by accident. The guard now sits below the hooks.

Both hook checks stay. The scanner cannot see conditionals, loops or
callbacks; eslint can. The scanner has no dependencies and catches the exact
shape that reached production. Neither subsumes the other.

## The typecheck baseline now enforces

`scripts/typecheck-baseline.mjs` printed a count and exited 0. Every "typecheck
196, unchanged" in a report was a human reading a number.

It now compares a **multiset of normalised diagnostic identities** —
`file :: TScode :: message`, with line and column dropped so that adding an
import does not read as forty regressions — against a committed
`typecheck-baseline.json` (196 diagnostics, 106 identities).

It fails on:

- a diagnostic not in the baseline, or more of one than recorded
- compiler/configuration errors (`TS5xxx`/`TS6xxx`)
- an incomplete run — killed, ENOENT, timeout, or no parseable output

**Verified three ways:**

| Scenario | Result |
|---|---|
| Introduce a new type error | exit 1, names the diagnostic |
| Fix nothing, add one error so the *total* is what it was | exit 1 — identities, not totals |
| Restore | exit 0 |

That middle row is the one the old script could never have caught.

The "incomplete run" case is why this matters: during the previous closeout the
count "improved" from 196 to 5 because a broken import made `tsc` give up
early. A falling error count was the symptom of something worse and the old
script reported it as good news.

The 196 are not a to-do list and were not touched. Almost all of it is one
thing: the Supabase client has no generated `Database` types, so
`.eq(col, value)` takes `{}` and rows infer as `never`.

## The practice smoke test now proves what it claimed

Retained heading nodes only hinted at state preservation. The test now:

1. loads the page and waits for **loading → ready** with the real heading
2. asserts **no React `pageerror`** and no dev error overlay — the four-day bug,
   caught directly rather than by proxy
3. opens the builder, types `Only the infield tonight, no catcher, work
   cutoffs` into "Anything specific?", and ticks the **baserunning** focus chip
4. closes the builder, opens the help panel, closes it with Escape
5. reopens the builder and asserts **both the typed text and the chip survived**
6. re-asserts no React error after all of it

## Production smoke check — NOT done, and not worked around

This sandbox's proxy answers `403` to `CONNECT mybenchcoach.com:443`:

```
curl: (56) CONNECT tunnel failed, response 403
"kind": "connect_rejected",
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)"
```

Both apex and `www` were tried. That is an access control, and I am not going
to route around one to test something.

**Every browser result in this report used an in-memory fixture. No production
data, production RLS, or real authentication has been exercised.**

A five-minute manual checklist is at the end of `docs/release-gates.md`, led by
the only question that really matters — *does the practice page render?* —
including what a failure looks like and what to tell me.

---

# PART 2 — CONTEXTUAL HELP EXPANSION

Five modules, in the order asked for. All reuse the existing registry,
`ModuleHelp`, `useUiPref` and the browser harness. **No new dependencies, no
new tables, no migrations.**

| # | Module | Route | Guide | Mount |
|---|---|---|---|---|
| 1 | Pitch Counter | `/dashboard/count` | new | start screen only |
| 2 | CoachAI | `/dashboard/chat` | updated | header, button only |
| 3 | Drill Library | `/dashboard/drills` | updated | above the finder |
| 4 | Game Day | `/dashboard/game` | updated | history view only |
| 5 | Lineup Builder | `/dashboard/lineup` | new | top of the page |

The registry is now **13 guides**. Both new ones appear under the right tasks
in the Help Center automatically (`prepare-for-a-game` gains both;
`record-what-happened` gains Pitch Counter).

## Pitch Counter — what it says, and what it refuses to say

I read `app/dashboard/count/page.tsx` before writing a word. Verified
behaviour, all of it reflected in the guide:

- A rule set is **optional**, chosen when a count starts, default
  **"Just count, no rules"**.
- With one chosen: the daily max shows, amber within 10 pitches, red at or past
  it, and the rule set's rest days appear.
- **With none chosen: no limit is shown at all.**
- The count **accumulates per pitcher per date**. "Switch pitcher" leaves a
  count open; picking that pitcher again the same day continues from where it
  was. "Finish" closes the day and can be reopened.
- **"Undo" is the correction** — it takes one off the same count.
- **It never blocks.** No disabled state, no confirmation, no stop. The button
  turns red and keeps counting.

The guide says, in as many words: *the warning tells you where the pitcher
stands against the rule set you picked — it does not stop the count, and it
cannot stop a pitch. Whether a pitcher keeps throwing is your decision and your
league's rules, not the app's.* It also says that if the rule sets do not match
your league, the numbers will not either.

**No enforcement claim. No compliance claim. No safety or medical claim.** All
three are asserted by tests, and I checked the tests fail when violated: a
deliberately doctored guide saying *"BenchCoach prevents the count going
further and keeps your pitcher safe"* trips both
`IT CLAIMS NO ENFORCEMENT OF ITS OWN` and `AND MAKES NO MEDICAL OR SAFETY
CLAIM`.

One subtlety worth recording: the enforcement check is **per sentence** and
allows the league to be the enforcer. An earlier, blunter regex failed the
sentence *"use whichever your league enforces"*, which is the correct thing to
say.

### The four states, tested exhaustively

`npm run test:pitch-count` — 30 checks. The display logic was extracted
**verbatim** into `lib/pitchCount.ts` (`count >= max`,
`count >= max - 10 && !over`, both sentences unchanged) so it could be tested:

- **no rule set** — nothing at 0, 40, or 200. *Silence is not approval*, and
  that is asserted.
- **rule set, under** — nothing at 0, 40, 64 of 75.
- **warning band** — opens at exactly 65 of 75, counts down in pitches, amber.
- **at and over** — 75 of 75 is already over, names the rule set, shows the
  real total past it, red.
- boundaries for a second rule set, and a max smaller than the warning band.
- `countingAllowed()` returns `true` at every level, and no message is phrased
  as an instruction to stop.

**No pitching rule or enforcement behaviour was changed.** `countingAllowed()`
exists so that the answer is written down rather than being the silent absence
of a `disabled` prop — if that ever changes, it is a product decision with
safety attached and it should start there.

One cosmetic defect left alone deliberately: at one pitch remaining the screen
says **"1 pitches to the daily max."** That is the product's existing string
and fixing grammar was not this phase's job. Flagging it rather than changing
behaviour mid-rollout.

## The other four

- **CoachAI** — now draws the priority-versus-pathway line from its own side:
  *a priority is CoachAI's answer to something happening now and ends when the
  thing is fixed; a development plan is a curated sequence with stages that
  runs for weeks*, and says where each is started. Mounted with `suppressCard`
  — the page is a fixed-height flex column and a card above the transcript
  would push the composer off screen, so only the "How to use this" button
  renders, in the header.
- **Drill Library** — **the proportion claim is gone.** It used to say "many do
  not" have video; the library grows and nothing keeps a number true. It now
  says only what is always true: *not every drill has one, the written
  instructions are the drill, and where a video exists it appears under
  "Supporting video"*. A test now fails any claim of the form
  *many/most/some/few/all …have…video*.
- **Game Day** — deliberately three steps, and **mounted only in the history
  view**. `view === 'live'`, `'setup'` and `'completed'` all return earlier, so
  a coach with a game running never sees it. It also tells a coach who is
  mid-game that they do not need to read any of it: *tap "Start Game" and
  score*.
- **Lineup Builder** — explains that the generator reads position eligibility
  and innings limits from the roster, that **every generated lineup is a draft
  to edit** ("Regenerate", "Start over", or "Set it myself"), and that nothing
  is saved until you save it.

## Checks and browser evidence

| Check | Result |
|---|---|
| `test:browser` | **101 passed, 0 failed** (was 71) |
| `test:help-content` | **103 passed, 0 failed** (was 66) |
| `test:pitch-count` | **30 passed, 0 failed** (new) |
| `test:onboarding` | 54 passed, 0 failed |
| `test:hook-order` | 120 files, 0 problems |
| `lint:hooks` | clean |
| `npm run gate` | 7/7 |
| typecheck | 196, **no new identities** |

Every quoted control name in all seven module guides is now asserted against
the component that renders it — including the drill finder's own components,
since the library page is only a shell. That check caught one of my own errors:
the guide said *"Start New Game"*, which is the setup screen's heading; the
button says **"Start Game"**.

Browser checks added for the five modules:

- each of the five renders, **raises no React error**, and offers a way into
  its guide
- the pitch guide, opened where a coach would open it, contains "does not stop
  the count", "no limit is shown" and "Just count, no rules", and contains no
  safety or enforcement language
- a **contributor** on Lineup Builder gets the full guide including the steps,
  is told the head coach builds lineups, and is offered **no action link that
  would fail**
- dismissing the Drill Library card leaves the button, survives a reload, and
  **does not dismiss Pitch Counter's** — per-module preferences really are
  per-module
- Pitch Counter at 375px: no sideways scroll, panel fits the phone

## Remaining limitations

1. **Nothing has run against production.** Supabase is a fixture; `/api/me` and
   `/api/entitlements` are stubbed. Production data, RLS and auth are untested.
2. **The counting screen itself was not browser-driven.** Driving a real count
   needs the pitch-count API and its tables in the fixture; the four states are
   covered exhaustively as unit tests instead, and the browser confirms the
   help placement. This is a deliberate trade and is why it is listed here.
3. **No coach has read any of it.** Whether the prose is useful is not
   something a test answers.
4. **No screen reader, no real device, no Safari or Firefox.**
5. **Playbooks is unchanged** — access preserved, navigation not expanded, and
   it still deliberately offers no action button.
6. **Support contact is still pending your decision.** The Help Center says
   only that there is no way to contact support from inside the app. Search
   recovery is "Clear the search" plus the task index.
7. **GitHub Actions does not block anything** until you enable branch
   protection.
8. Six modules still have no in-product entry point: Reports, Notes, Stats,
   Scouting, AI Memory, Staff, Account, League.

## Commits and deployment

| Commit | What |
|---|---|
| `87b869a` | Part 1 — release gate, eslint hooks, enforced baseline, stronger practice smoke |
| *(this commit)* | Part 2 — five module guides, mounts, pitch-count tests |

**Deployment status, separate from code completion:**

- **Part 1 — `87b869a` → `dpl_G9Jke1eJBdX9WvS6V5tnkgYnmM1m`, production,
  READY.** Verified, with the gate visible in its build log.
- **Part 2 — `f6d5692` pushed to `main`. Its deployment state is NOT verified.**
  The Vercel API became unavailable to this session before I could check, so I
  am not going to state an outcome I did not see. It will have run the same
  gate, and the gate passed locally on exactly this tree; if the build failed,
  production stays on `87b869a` and nothing is lost but the new help.
  Check it at
  vercel.com/clints-projects-2a091ff7/bench-coach, or tell me and I will
  confirm when the API is back.

That a build deployed is verified for Part 1 only. That any of it works in
production is not verified at all — see the manual checklist.
