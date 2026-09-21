# Playbooks is in the sidebar

Closing the one product decision that was carried, unresolved, through
phases 2I, 2J, 2K and 2L. Commit `310910e`.

## What the state actually was

`/dashboard/playbooks` was a real, working, 1,019-line page with **no way to
reach it from inside the app**. Not disabled, not behind a flag, not
half-built — reachable only by typing the URL.

The codebase did not merely omit it. It argued for the omission in three
places, and all three had to be undone together or the product would have
contradicted itself:

| Where | What it said |
|---|---|
| `app/dashboard/layout.tsx` | *"Playbooks is deliberately absent — the page still exists, it is just not a destination. It duplicates what a priority does, without the evidence."* |
| `lib/helpContent.ts` | The guide's `requiresNote`, one step, one problem and its `nextAction` were each written around being unreachable |
| `lib/helpRoutes.ts` | `primaryActionFor('playbooks')` returned null: *"offering a link to a feature the product has stopped surfacing would be making a product decision inside a help article"* |

That last comment was the right instinct and is why the item kept getting
carried rather than quietly fixed. Reversing it needed the product decision
made first, not inferred from a help article.

## The decision

**The duplication concern is real and has not gone away.** A Playbook and a
development-plan priority do overlap, and the Playbook is the one without the
evidence behind it. Nothing in this change resolves that.

What it does resolve is the worse half of the trade: a feature nobody could
navigate to earns nothing and teaches nothing. Shipped-and-hidden is not a
cautious middle ground — it is the cost of both options with the benefit of
neither. If the duplication argument is right, the way to act on it is to
retire the feature, not to leave it running where only a URL finds it.

So the entry goes in, and the guide keeps drawing the line rather than
pretending there isn't one:

> A Playbook is a fixed programme: a set list of sessions in a set order that
> you work through and tick off. It does not change on what you see, and it is
> the same programme whether you start it for the whole team or for one
> player. A development plan is the other way round: stages a player only
> moves up when you judge they are ready, with measurements and a record of
> what you decided. Pick a Playbook when you want a set programme followed;
> pick a development plan when the next step should depend on how the player
> is actually doing.

**The first version of that answer was wrong, and is worth recording.** It
said to use a Playbook for the whole team and a development plan when working
with one kid — framing the distinction as team versus individual. That
contradicted the guide's own step two steps above, which names "Whole Team"
**and** "Specific Player" as the real options on the start dialog, and it
would have sent a coach who wanted a set program for a single player to the
wrong tool.

The distinction is **fixed sessions versus progression you assess**, and it
holds at either size.

> **Superseded by `docs/program-choice.md`.** Correcting one sentence in one
> guide was not enough: the two features were confusing wherever a coach met
> them, not only in the help. The wording above now lives in
> `lib/programChoice.ts`, which the Playbooks page, the player profile and
> both guides all render, and the exact copy is recorded in that document.
> The quoted paragraph here is the version that shipped in `51a3b13` and is
> kept for the record, not as current copy.

## What changed

**The nav entry** — Planning group, between Practice Plans and Drill Library:

```tsx
{ label: 'Playbooks', href: '/dashboard/playbooks', icon: Book, needs: 'decide' },
```

Two choices worth stating:

- **`needs: 'decide'`.** Starting a playbook assigns a multi-week programme to
  a team or a player. That is the same rung as building a practice plan or a
  lineup, and `lib/authz.ts` already had the word for it. A contributor gets
  neither Playbooks nor Practice Plans, which is the existing behaviour and
  not a new restriction.
- **Deliberately not `needsTeam`.** Practice Plans carries `needsTeam: true`;
  this does not. A parent on the Personal plan running a programme with their
  own kid is exactly who a fixed multi-week programme suits, and the page
  works from any workspace's id. Gating it on a team would have removed it
  from the people most likely to use it.

**The guide** was rewritten around the page's real controls — Progression
Playbooks, Start Playbook, Whole Team / Specific Player, Mark Complete, Active
Playbooks — rather than around its absence.

**The action** now resolves, gated on a valid team id:

```ts
case 'playbooks':
  return { label: 'Open Playbooks', href: withTeam('/dashboard/playbooks', ctx), enabled: !!safeId(ctx.teamId) }
```

## Checks

| Check | Result |
|---|---|
| `npm run gate` | **8/8** |
| `test:help-content` | **197 passed, 0 failed** |
| `test:browser` | **186 passed, 0 failed** |
| typecheck | **196 diagnostics, no new identities** — the committed baseline holding, not a clean typecheck |

The gate was run locally with the same placeholder environment
`.github/workflows/checks.yml` supplies, because this container has the
Supabase URL but not the anon key or `ADMIN_EMAIL`, and the environment check
is the gate's first step.

Ten new browser checks, in a real browser against the real app on a fixture
backend:

- the sidebar has a Playbooks entry, and its href carries the team
- following it reaches a page that renders, and it is the page the guide
  describes ("Progression Playbooks")
- a contributor is offered neither Playbooks nor Practice Plans
- the article no longer says it is missing, tells a coach where the entry is,
  still says which of the two to reach for, and offers a way there

Six assertions in `test-help-content.ts` were **inverted** rather than added —
they previously asserted the guide said it was unreachable. An assertion that
had been passing for months by describing the wrong product is the failure
mode this whole test file exists to catch, which is why the inversion is
spelled out here.

## Deployment

`310910e` → `dpl_G8BTfBFVLQ2r19uvoTLjKmLhguuW`, target production, **READY**.

## What this does not cover

- **Nothing was verified against production.** Fixture backend, stubbed
  `/api/me` and `/api/entitlements`. Unchanged and still the largest gap; the
  manual checklist at the end of `docs/release-gates.md` is the only thing
  that closes it.
- **The duplication question is still open.** This change makes the feature
  reachable so it can be judged. It does not decide whether Playbooks and
  development plans should both exist.
- **No usage evidence yet.** The argument for removing it was always that it
  earns nothing; it could not earn anything while it was unreachable. That
  becomes answerable now, and is the thing to look at before deciding again.
