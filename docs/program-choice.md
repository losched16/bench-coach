# Playbooks and Player Development Plans

Clint could not tell the two apart. The help had made it worse by explaining
the difference as **team versus individual**, which is wrong — a Playbook runs
for a whole team *or* for one player.

This is the record of what each one now says, where it says it, and what was
verified.

---

## What was verified first

Before any copy was written, both features were read:

**Playbooks** — `app/dashboard/playbooks/page.tsx`, `player_playbooks`

- `player_id` is **nullable**. "Whole Team" and "Specific Player" are both real
  buttons on the Start Playbook dialog, and both were already working.
- A template carries `total_sessions` and `sessions_per_week`. The sessions are
  fixed in advance.
- Progress is `completed_sessions: number[]` — a list of sessions marked done.
- There is no stage, no readiness gate, and nothing that reacts to what a coach
  records. **A playbook is the same list on day one and day forty.**

**Player Development Plans** — `components/PlayerDevelopment.tsx`,
`lib/playerPathways.ts`, `player_pathway_progress`

- Per player, started from the player's profile.
- Stages carry `mastery_signals`, which the coach ticks as observations.
- `lib/playerPathways.ts` is explicit: *"Nothing here advances a player.
  canAdvance() answers a question; a route calls it because a human pressed
  the button."*
- The stage detail page already said it in the product's own voice: **"Is he
  ready for the next thing? Your call. The measurements and the signals above
  inform it; they do not make it."**

So the real difference is **what decides the next step**, and it holds at
either size.

One consequence: the brief called these "readiness criteria". The product's own
word is **mastery signals**, and that is what the copy uses — a guide that
names a control the screen does not have is the failure this help system exists
to avoid.

---

## The exact copy

All of it lives in **`lib/programChoice.ts`** and is imported everywhere it
appears. Nothing below is retyped on a screen.

### The two descriptions

**Playbooks** — tagline `Follow a preset program`

> Follow a planned sequence of sessions with your team or an individual player.
> Mark each session complete as you work through the program.

**Player Development Plans** — tagline `Track an individual's skill progression`

> Work through skill stages with {player}. Record sessions and observations,
> then use the stage's mastery signals to decide when they are ready to
> advance.

`developmentBlurb(name)` takes the player's name where there is one, so the
player profile reads "with Marcus" and the generic guide reads "with one
player" — one sentence, one definition.

### The distinction

> A Playbook is a fixed program: the sessions are set in advance and you work
> through them in order. It is the same program whether you start it for the
> whole team or for one player. A Development Plan is a stage sequence for one
> player, and the next stage comes when you decide they are ready.

### The decision aid

> If you want a ready-made series of sessions to follow, use Playbooks. If you
> want to track one player and advance them when they are ready, use a
> Development Plan.

Deliberately unquoted: the content test checks that quoted strings in a guide
are real control labels, and an earlier guide tripped exactly that check by
quoting an illustrative phrase.

### Session completion is not mastery

> Finishing a session is not the same as showing mastery. Advancing a player is
> always your call.

### In-place copy

| Where | Copy |
|---|---|
| Start Playbook dialog, under "Assign To" | Same program either way — this only decides who it is tracked against. |
| Playbooks empty state | Pick a program from the Library and start it for the whole team or for one player. The sessions are set in advance — you work through them in order. |
| Development plan picker, under the heading | Each plan is a sequence of stages. You decide when to move on. |
| Cross-link, Playbooks → plans (no player) | Tracking one player stage by stage, and advancing them when they are ready? **Pick a player to start a Development Plan** |
| Cross-link, plans → Playbooks | Want a ready-made series of sessions to follow instead? **Browse Playbooks** |

---

## Locations changed

| File | What |
|---|---|
| `lib/programChoice.ts` | **New.** Every string above, plus the two cross-link builders. |
| `components/ProgramChoiceNote.tsx` | **New.** Renders the blurb and one link to the other feature. |
| `app/dashboard/playbooks/page.tsx` | Intro note replaces the old subtitle; `ModuleHelp` mounted (the page had none); empty state; the Start dialog line; `useRole` for permissions. |
| `components/PlayerDevelopment.tsx` | Empty state now renders `developmentBlurb(playerName)`; cross-link; picker subtitle. |
| `app/dashboard/roster/[playerId]/page.tsx` | Reads `?tab=` so the cross-link lands on Development. |
| `lib/helpContent.ts` | Both guides import their purpose, summary and "Which should I use?" answer. Spelling normalised to `program`. |
| `components/help/ModuleHelp.tsx` | A card no longer offers to open the page it is already on. |
| `scripts/test-help-content.ts` | 27 assertions. |
| `scripts/browser/help.spec.mjs` | New block, plus fixture support for playbooks and the player detail page. |

### The old subtitle, and why it went

The Playbooks page said **"Step-by-step training programs to build specific
skills"**. That is true of a development plan too, so it told a coach nothing
about which of the two they were looking at. An assertion now fails if it
comes back.

---

## Two things found by looking at the screens

The overflow assertions passed and the screenshots still showed two defects.
Both were introduced by mounting the first-use card on the Playbooks page:

1. **Two spellings of the same word on one screen.** The new copy said
   "program"; the guide beside it said "programme". Normalised to `program`,
   which is what the rest of the app uses ("Step-by-step training programs",
   "Progression Playbooks"). An assertion pins it.

2. **The card offered "Open Playbooks" to a coach standing on Playbooks.** A
   guide's primary action is written for the Help Center, where it is the
   useful thing to offer. Fixed in `ModuleHelp` by dropping an action whose
   path matches the current one — **general, not a Playbooks special case**, so
   every module's card benefits.

---

## What was deliberately not changed

- **Feature names and behaviour.** No renames, no merge, no change to who can
  start what, no change to how advancement works.
- **`app/page.tsx` (marketing).** It already says *"Perfect for parents working
  with one kid or coaches focusing on a specific skill with the whole team"* —
  correct about both targets. One line nearby reads *"start a progression
  playbook. Everything adapts to your team,"* which sits close enough to imply
  a playbook adapts. It does not. **Flagged, not changed** — editing positioning
  copy is a marketing decision, not a clarity fix.
- **The Playbooks page does not check the role before writing.** The sidebar
  gates on `decide` and RLS is enabled with team-scoped policies on
  `player_playbooks`, so a deep-link cannot write outside the coach's teams.
  Pre-existing, out of scope, recorded here.

---

## Checks

| Check | Result |
|---|---|
| `npm run gate` | **8/8** |
| `test:help-content` | **224 passed, 0 failed** (was 197) |
| `test:browser` | **217 passed, 0 failed** (was 187) |
| typecheck | **196 diagnostics, 0 new identities** |

The typecheck line is **not a clean typecheck** — it is the committed
196-diagnostic baseline holding, compared by identity so a fixed error cannot
mask a new one. The gate was run with the placeholder environment
`.github/workflows/checks.yml` supplies, because this container has the
Supabase URL but not the anon key or `ADMIN_EMAIL`.

Thirty new browser checks drive the real screens in a real browser: the
Playbooks page states both targets and both no-promise lines; the cross-link
carries the team and reaching the roster keeps it; the Start dialog offers both
targets and says they run the same program; the first-use card is suppressed
once a playbook is running but the guide stays reachable; the `?tab=` deep link
lands on Development rather than Overview; the empty state names the player;
and a contributor reads the difference but is not offered a link to start
something they cannot start.

Screenshots at 375px and 1440px are in `docs/audits/`, and were looked at —
that is how both defects above were found.

---

## Limitations

1. **Nothing verified against production.** Fixture backend, stubbed
   `/api/me`, `/api/entitlements` and `/api/player-pathways`. Unchanged and
   still the largest gap.
2. **`?tab=` is read once, as the initial value.** A coach who arrives on
   Development and presses Measurements stays on Measurements; the URL is not
   kept in sync, and the back button does not step between tabs. That is a
   deliberate choice, not an oversight — re-syncing would drag a coach back to
   the tab the link named.
3. **Whether the distinction now lands is untested.** The assertions prove the
   wrong framing is gone and the right one is present on the screens where a
   coach chooses. They cannot prove a coach reads it and understands.
4. **The guide's first step still says "Open Playbooks under Planning"** when
   read from the Playbooks page itself. Correct in the Help Center, mildly
   redundant in-page. Left alone rather than forking the content.
