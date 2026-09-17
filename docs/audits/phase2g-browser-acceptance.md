# Phase 2G.15 — Browser acceptance

```
npm run accept:pathway-ui        90 passed, 0 failed
```

30 checks, run three times: **1440 desktop, 430 mobile, 390 mobile.** Identical
results at all three.

## What is actually under test

`app/dev/pathway-harness` mounts the **real** `<PathwayPicker>` and the **real**
`<PathwayContextCard>` — not copies, not mocks — over a fixture shaped like
Build the Swing. The component, the stage navigation, the focused-stage
wording, the disabled-at-the-ends buttons and the DOM are the ones that ship.
Only the data loader is replaced.

The harness returns `null` in production. `next build` still compiles the
route, so it cannot rot silently.

A `<pre id="state">` carries the selection and the recorded analytics, so the
run asserts on data rather than on what the DOM happens to look like.

## The 30 checks

| # | Check |
|---|---|
| 1 | the pathway option is offered |
| 2 | published pathways listed with name, summary, category, stage count |
| 3 | choosing Build the Swing selects it and lands on stage 1 |
| 4 | the stage heading reads "Stage 1 of 10" |
| 5 | the stage objective renders |
| 6 | mastery signals render |
| 7 | next moves to stage 2 |
| 8 | previous moves back to stage 1 |
| 9 | previous is disabled on the first stage |
| 10 | jumping straight to a stage works |
| 11 | **next is disabled on the final stage — no invented stage 11** |
| 12 | a one-drill stage says "Focused stage" and stays usable |
| 13 | **internal curation words never reach the screen** |
| 14 | a three-drill stage carries no badge |
| 15 | selection and stage changes are tracked |
| 16 | stage events carry slug, number and key — and nothing name-shaped |
| 17 | clearing the pathway returns to the unselected picker |
| 18 | the picker is operable by keyboard alone |
| 19 | the focused control is visibly focused |
| 20 | a failed load says it failed and does not claim emptiness |
| 21 | a failed load still offers normal planning and a retry |
| 22 | genuinely no pathways reads differently from a failure |
| 23 | stages failing to load is reported on the chosen pathway |
| 24 | a pathway with no stages says so and offers a way out |
| 25 | the generated plan shows the development focus |
| 26 | a zero-feasible warning is shown, not swallowed |
| 27 | **a plan built with no pathway renders no context card at all** |
| 28 | no horizontal scrolling |
| 29 | tap targets are at least 32px tall |
| 30 | no pathway or stage name is clipped |

Checks 20/22 and 23 are the 2G.11 requirement stated precisely: a failed load
and a genuinely empty world must not read the same. The run asserts that the
error copy appears **and** that the empty copy does not, in both directions.

## A defect this run found

**Check 29 failed at all three widths on the first run.** The "Clear" button
was bare text with no padding and measured under 32px tall — and it is the one
control a coach reaches for one-handed to get back to normal planning. Fixed
with `px-2 py-2` and a compensating `-mr-2`; re-run is clean.

Found by measuring rather than by looking, which is the only way this class of
thing gets found.

## The live-browser gap — stated plainly

**These 90 checks did not touch production.** The shipped picker lives inside
the Generate Practice modal on `/dashboard/practice`, behind a login.

- `mybenchcoach.com` is unreachable from this environment: the network gateway
  answers `403` to `CONNECT`.
- The Vercel deployment aliases sit behind Vercel SSO.

So nobody here can log in, open the modal and look at it. What is proved is
that the real components behave correctly in a real Chromium at three widths,
plus `verify:pathway-ui-prod` proving the live data those components will be
handed satisfies every assumption they make.

**What remains unverified is the composition:** the picker rendered inside the
real modal, on the real page, with a real coach's team. That needs one person
to open the modal on a phone. It is the single manual step this phase asks for.
