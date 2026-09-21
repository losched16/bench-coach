# Phase 2K — Carryovers, then Record-Keeping Help

## Deployment confirmed

`f6d5692` is live. Confirmed from the Vercel API rather than from the GitHub
status:

| | |
|---|---|
| Deployment | `dpl_9rG8ZvyaMrBqiZaSyBfmzhtpCvMN` |
| Commit | `f6d56923a21a5fc6c925faddd6b9f2d0da84f54c` |
| Target | production |
| State | READY |
| Aliases | `mybenchcoach.com`, `www.mybenchcoach.com`, `bench-coach.vercel.app` |

That resolves the unknown I left at the end of the last phase.

**This is a deployment fact, not a feature fact.** Nothing in this report has
been exercised against production data, production RLS or real authentication.
Every browser result below ran against the in-memory fixture. The manual
checklist at the end of `docs/release-gates.md` is still the only thing that
can close that gap, and it still needs you.

---

# The three carryovers

## 1. The pitch-count tests were running nowhere

**Verified before changing anything, as asked.** `test:pitch-count` was defined
in `package.json` and invoked by nothing: not the workflow, not the release
gate, not another script. A grep across `.github/`, `scripts/` and
`package.json` found only its own definition and the usage line in its header
comment. So the suite that asserts the pitch guide claims no enforcement, no
compliance and nothing medical had been running only when I ran it by hand.

It is now in **both**:

- the release gate, which is what actually blocks a deployment — the gate is
  **8 checks** now, and it stays fast (~15s)
- the CI `suites` job

Being in the gate is the meaningful half. If somebody edits the pitch guide to
say the app keeps a pitcher safe, the build fails and production does not move.

## 2. The Pitch Counter screen is now driven, not just described

The fixture gained what real counting needs: generated ids on insert,
`Prefer: return=representation` honoured on POST and PATCH (including
`.single()`), and `ilike`. Then the browser suite drives the actual screen.

**18 checks, all passing:**

| Flow | Result |
|---|---|
| Rule dropdown defaults to "Just count, no rules" | ✓ |
| A new count starts at zero | ✓ |
| Three taps count three | ✓ |
| **No rule set → no warning at all, at any count** | ✓ |
| **Undo takes one off** | ✓ |
| Reload → the count waits under "Still counting" | ✓ |
| **Resuming carries the count rather than restarting** | ✓ |
| One row holds the day rather than several | ✓ |
| Selected rule, well under → nothing is said | ✓ |
| The rule set is named on the counter | ✓ |
| **Warning state at 5 of 15 → "10 pitches to the daily max."** | ✓ |
| **Over state at 15 → "Daily max for Little League 12U is 15. He's at 15."** | ✓ |
| **The count button is still enabled past the max** | ✓ |
| **Counting past the daily max is allowed — it warns, it does not block** | ✓ |
| Past the max it shows the real number, not the max | ✓ |

The four states the guide describes are now confirmed on the real screen, in a
real browser, including the one that matters: **it does not stop you.**
Counting and rule behaviour were not modified — the test reads the screen, it
does not change it.

## 3. `docs/release-gates.md` now quotes the right build

The excerpt in it was from a build *before* the gate existed, where `prebuild`
was still `verify-env.mjs` alone. It proved the mechanism but not the gate,
which is a different claim and the document was making the stronger one.

Replaced with the log of `dpl_9rG8ZvyaMrBqiZaSyBfmzhtpCvMN` showing all seven
checks running and passing, plus a note that it is eight from the next
deployment. The old excerpt is described rather than deleted, so the difference
is legible.

---

# Repository protection

**I could not read the current settings.** The GitHub MCP tools available in
this session cover branches, files, PRs, issues and reviews — there is no
branch-protection or ruleset tool among them. So I am not going to state what
is configured. What I can say with certainty is that **every commit in this
repository has been a direct push to `main`**, which is only possible with no
protection requiring a pull request.

## The exact settings needed

**Required check names: `gate`, `suites`, `browser`.** Nothing longer.

A required status check is matched by the check-run name, which is a job's
`name:` in the workflow. I **shortened all three job names this phase** for
exactly this reason — they were sentences like
`release gate (same checks Vercel runs)`, and a required check whose name
drifts silently stops being required, while one that no longer exists blocks
every merge instead.

1. **Settings → Rules → Rulesets → New branch ruleset**
2. **Target branches:** include `main`
3. **Require status checks to pass** → add `gate`, `suites`, `browser`
   - also tick **Require branches to be up to date before merging**
4. **Require a pull request before merging** — and this is the one that
   decides whether any of it matters. **Without it, a direct
   `git push origin main` is not covered by required checks.** Every commit
   here has been a direct push, so leaving this off means the ruleset changes
   nothing in practice.
5. **Bypass list:** adding yourself keeps your direct pushes working and makes
   the checks binding on pull requests only. Leaving it empty means a PR for
   every change, including fixing a broken `main`.

The trade in step 4 is yours and there is no setting that gives both.

**Until a ruleset exists, `.github/workflows/checks.yml` blocks nothing.** It
runs on every push and PR and uploads the screenshots. A red run stops neither
a merge nor a deploy. The only thing that stops a deploy is `npm run gate`
running as `prebuild` inside the Vercel build.

---

# Contextual help — the record-keeping modules

Four workflows. The registry is now **16 guides**; every one is reachable from
a task in the Help Center.

## Player Reports — at the real entry point

Mounted **inside the Reports tab of a player profile**, which is the only way
into the feature. There is no reports index page, and the guide says so
outright, because a coach who goes looking for "Reports" in the sidebar will
not find one.

The guide walks the actual two-part workflow, with the real control names
checked against the source: **"Create Player Report"** / **"Continue draft"**,
the **"Start from what you have already recorded?"** question, the
**"Report setup" / "Strengths" / "Development" / "Closing"** sections,
**"Preview the PDF"**, **"Finalize report"**, **"Open PDF"**.

Two things it is careful about:

- **A draft is not sent anywhere.** Stated in the step, because the sections
  are pre-filled from a coach's own notes and that can read as though something
  has already gone out.
- **A finalized report is revised, not edited.** The original stays as it was —
  which is the point if it has already reached a family.

Permissions are real: `canCreate` is passed through from the profile's
`allowed('decide')`, so a contributor gets the whole guide and an explanation
rather than a button that fails.

## Notes and Log an Entry — told apart

These are the two places a coach writes something down, and the guides' main
job is the distinction. Both sides now state it, and a test asserts both:

> **Notes are what you think. Log an Entry is what happened.** A note is
> standing context that stays true: he is scared of the ball, or you have no
> catcher until June. An entry is one dated event — this game, this practice,
> this lesson. **If it has a date attached, log it; if it describes how things
> are, note it.**

The log guide also warns that a written entry with no box score adds context
but no batting averages, which is the "why didn't my stats change" question
before it gets asked.

## Stats — entered versus calculated

The distinction the brief asked for, in the guide's own words:

> You provide the raw counts — at-bats, hits, innings, pitches — from each
> game's box score. Everything with a rate in it is **calculated from those**.
> Change a game and the calculated numbers change with it; there is nothing
> stored separately that could disagree.

It also says plainly that the page is read-only arithmetic and that nothing
arrives on its own. No capability is passed to `ModuleHelp` because there is
nothing here to allow or refuse.

## Scouting — the limitation first

The first thing in the problems list is not a problem with the product, it is
the limit of the evidence:

> **How much can you trust the rest-day estimate?** Only as much as the count
> it came from. It is worked out from pitches you recorded by hand, against a
> rule set you chose, and it **has no idea what that pitcher threw in a game
> you did not watch.** Treat it as your own notes doing arithmetic, not as
> information about their team.

It covers correcting a wrong name or count, warns that re-logging a game
double-counts it, and states that **scouting is never pooled between coaches** —
consistent with the standing no-cross-account-aggregation rule.

---

# Checks

| Check | Result |
|---|---|
| `npm run gate` | **8/8** (pitch counter newly included) |
| `test:help-content` | **146 passed, 0 failed** (was 103) |
| `test:pitch-count` | 30 passed, 0 failed |
| `test:onboarding` | 54 passed, 0 failed |
| `test:hook-order` | 120 files, 0 problems |
| `lint:hooks` | clean |
| typecheck | 196, no new identities |
| `test:browser` | see below |

Every quoted control in all eleven module guides is asserted against the
component that renders it. For reports that means three files — the tab
component, the report route and the player profile — because the workflow
spans them.

One of my own errors was caught by that check while writing this: illustrative
note text in the Notes guide was being read as a control name. Reworded so the
examples are not quoted.

---

# Remaining limitations

1. **Nothing has been verified against production.** Fixture backend, stubbed
   `/api/me` and `/api/entitlements`.
2. **The Player Reports guide is not browser-driven end to end.** Reaching the
   Reports tab needs a player profile, which pulls in several more tables than
   the fixture models. Its content and control names are asserted against
   source, and the component mounts help at the right place, but no browser
   opened that tab.
3. **No screen reader, no real device, no Safari or Firefox.**
4. **Playbooks navigation unchanged.** Still a real page, still not in the
   sidebar, still deliberately offering no action button.
5. **No support destination invented.** The Help Center still says only that
   there is no way to contact support from inside the app.
6. **Branch protection unread and unchanged** — see above.

---

# Final phase — the administration modules

Five left, and they are different in kind from everything so far: a coach does
not visit them weekly, and getting them wrong costs access rather than a
practice.

| # | Module | Route | Note |
|---|---|---|---|
| 1 | **Staff** | `/dashboard/team` | The highest value of the five. This is where the capability words a coach keeps meeting — who can record, who can decide — become visible. The guide must use the same words the role selector uses, or it teaches a second vocabulary. |
| 2 | **AI Memory** | `/dashboard/memory` | The one module whose behaviour a coach cannot predict from the UI: what is remembered, what it changes, how to remove something. It is also `coach_preferences`, which is keyed on `coach_id`, so an invited assistant may see nothing — the guide has to say why rather than reading as broken. |
| 3 | **Account** | `/dashboard/profile`, `/dashboard/settings` | Two routes, one guide. Billing, team switching, sign-out. |
| 4 | **League Admin** | `/league-admin` | **Not `/league`** — that route is only an invite link. Scope carefully: league admins do not gain player-level access by sponsorship, and the guide must not imply they do. |
| 5 | **Profile** | `/dashboard/profile` | Folds into Account unless it turns out to carry its own workflow. |

Recommended order is the table order: Staff first because it explains the
permission model every other guide refers to, AI Memory second because it is
the most surprising, and the rest are short.

Two things to decide before that phase, both of which have been carried for a
while and neither of which I should decide:

- **Playbooks navigation** — sidebar entry, or leave it deep-linked and say so.
- **A support destination** — until one exists, every guide ends at a dead end
  if the product cannot answer the question.
