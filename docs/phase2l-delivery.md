# Phase 2L — The Administration Modules

The last four. Staff, AI Memory, Account and League Admin, which completes the
contextual-help rollout across BenchCoach.

Two of these guides make claims about who can see what a coach records about
children, so most of the care in this phase went there rather than into prose.

---

## What the code said that I had predicted wrong

I read each page before writing a word, and two of my own predictions from the
last report were wrong:

**1. "AI Memory is keyed on `coach_id`, so an invited assistant may see
nothing."** Not true. `app/dashboard/memory/page.tsx` loads
`coach_preferences` for **`team.coach_id` — the team owner's** — not the
viewing coach's. So an assistant sees the owner's preferences, and can delete
them. The guide says that outright rather than describing a per-coach list
that does not exist.

**2. "Profile folds into Account unless it carries its own workflow."** They
are different scopes:

- `/dashboard/profile` — **"Profile Settings"**: your name, password, billing,
  which teams you are on. Personal, follows you between teams.
- `/dashboard/settings` — **"Team Settings"**: team info, season, focus areas,
  player report branding. Per-team, changes what everyone sees.

Conflating them would be exactly the error this whole exercise keeps catching,
so they are **two guides**, and each sends a coach to the other for the thing
it does not do. That is five guides for four modules.

---

## The guides

### Staff — the permission vocabulary, in the page's own words

Mounted on `/dashboard/team`. The role descriptions are taken from the role
selector itself, and a test asserts each name appears in both the guide and
the page:

> **Viewer** can read and ask CoachAI. **Contributor** can also record what
> happens — log entries, keep the book, count pitches. **Admin** can decide
> things: build practice plans and lineups, start development plans, write
> reports. Only the **Team Owner** manages staff and billing.

That is the vocabulary every other guide's `requires` field leans on, so it had
to match `lib/authz.ts` rather than invent a second one.

It also says the obvious thing nobody had written down: **a missing button is
a role, not a bug**, and that the invite link is the invitation — no email is
sent from this page.

### AI Memory — deleting here deletes everywhere

Mounted on `/dashboard/memory`. Three facts a coach cannot get from the
screen, all verified in the handlers:

- **This page is a view, not a second copy.** Deleting a team note here
  removes it from Notes, for the whole staff.
- **Preferences belong to the team owner**, so everyone sees one shared list.
- **Nothing is remembered on its own.** CoachAI stores something only when it
  offers and somebody accepts.

A test asserts the guide claims **no automatic learning** — no "learns from
your conversations", no "trains on", no "gets smarter". The product does not
do that and the help must not suggest it.

### Account, and Team Settings

`/dashboard/profile` gets the account guide; `/dashboard/settings` gets the
team one. Each names the other for what it does not cover, because "where do I
change the season" and "where do I change my password" are the two questions
these pages actually generate.

The account guide mounts with `hasTeam` unconditionally true and its action
carries **no `teamId`** — it is about the person, and it has to work for a
coach who has no team yet, which is exactly who needs it.

### League Admin — the boundary

Mounted on `/league-admin`. **Not `/league`**, which is only an invitation
link — a distinction I got wrong in an earlier report and corrected by reading
the routes.

The page's own header comment states the constraint, and the guide now says it
to the commissioner:

> **You cannot, and that is deliberate.** This dashboard shows adoption only —
> who was invited, who accepted, who has opened the app, how many plans exist.
> There is no route from here into a plan's contents, a player note, a
> scouting report or a CoachAI conversation. **Sponsoring a league does not
> give you access to what its coaches record about children.**

It also separates the two hats: if you also coach a team in the league, that
access comes from being on that team, not from administering the league.

Four assertions cover this, and I verified they **fail** when the guide is
doctored to claim a commissioner can open a team's plans.

---

## The type system caught four things

Adding these guides broke the build in four places, and the enforced typecheck
baseline reported every one rather than letting a count absorb them:

| What | Why it mattered |
|---|---|
| `TASK_ICON` missing `set-things-up` | The Help Center's icon map is exhaustive over `HelpTask` by design — the compiler catching this is the map working |
| `ModuleHelp` import missing on the profile page | My patch added the component and not the import |
| `'own'` not assignable to `HelpRequirement` | The real finding — see below |
| Test stub narrowed to `'record' \| 'decide'` | Followed from the same change |

**`'own'` is a real rung in `lib/authz.ts`** and Staff genuinely requires it —
managing staff is the owner's, not an admin's. Rather than downgrade the guide
to `'decide'` and have it quietly lie, `HelpRequirement` now carries `'own'`,
and `ModuleHelp`'s `can` prop was widened to match. Every existing caller still
type-checks because `useRole().can` already took the wider union.

Baseline is back to **196, no new identities**.

---

## Checks

| Check | Result |
|---|---|
| `npm run gate` | **8/8** |
| `test:help-content` | **194 passed, 0 failed** (was 146) |
| `test:pitch-count` | 30 passed, 0 failed |
| `test:onboarding` | 54 passed, 0 failed |
| `test:hook-order` | 120 files, 0 problems |
| `lint:hooks` | clean |
| typecheck | 196, no new identities |
| `test:browser` | **176 passed, 0 failed** (was 146) |

Browser coverage added for all five surfaces: each renders, raises **no React
error**, and offers a way into its guide; the Staff, AI Memory, League Admin
and Account guides are read out of the rendered panel for the claims above;
Account help shows **with no team selected**; dismissal survives a reload and
**dismissing Staff does not dismiss AI Memory**; Staff at 375px has no sideways
scroll and its panel fits the phone.

Two of the new assertions were verified to bite: a doctored guide claiming a
commissioner can read team plans, and one claiming CoachAI trains on your
conversations, both fail.

---

## The rollout is complete

**21 guides**, every one reachable from a task in the Help Center, covering
every module a coach can open:

| Task | Guides |
|---|---|
| Plan my next practice | practice-plans, drill-library, getting-started |
| Help a player improve | skill-development, player-development, coachai, playbooks |
| Add or import my roster | roster, getting-started |
| Record what happened | skill-development, game-day, pitch-counter, notes, log-entry, stats |
| Prepare for a game | game-day, pitch-counter, lineups, scouting |
| Create a player report | player-reports |
| **Set up my team and account** | **staff, ai-memory, account, team-settings, league-admin** |

---

## Remaining limitations

1. **Nothing has been verified against production.** Fixture backend, stubbed
   `/api/me` and `/api/entitlements`. This is unchanged and still the biggest
   gap; the manual checklist in `docs/release-gates.md` is the only thing that
   closes it.
2. **League Admin's browser case uses a stubbed league API.** League
   membership lives behind `requireLeagueRole()` and tables the fixture does
   not model, so `/api/league/me`, `/api/league-admin/overview` and
   `/api/league-admin/members` are stubbed per case — the same way `/api/me`
   and `/api/entitlements` already were. What that proves is the help on that
   page, not who is allowed to reach it. The first run of this case failed
   loudly ("no help entry point rendered — this account has no league in the
   fixture") rather than skipping, which is why the stub exists.
3. **Player Reports is still not browser-driven end to end** (carried).
4. **No screen reader, no real device, no Safari or Firefox** (carried).
5. **Branch protection still unread and unset.** Required check names are
   `gate`, `suites`, `browser`; the settings are in `docs/release-gates.md`.
   Until a ruleset exists, the workflow blocks nothing and only the Vercel
   build gate can refuse a deploy.
6. **Playbooks navigation unchanged** — still a real page, still not in the
   sidebar, still offering no action button.
7. **No support destination.** Twenty-one guides now end at a product that
   cannot be asked a question. This is the one carried item that has grown
   more awkward with every phase, and it is a configuration decision, not a
   code one.
