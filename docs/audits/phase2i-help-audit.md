# Phase 2I — onboarding and contextual help: what is actually true

The brief supplied six findings from a review at `32ebacbf` and asked for them to
be treated as leads. Every one was checked against the code. Five hold, one is
importantly wrong in a way that changes what to build, and the audit turned up
four things the review did not mention — one of which would have been a bad bug
had I taken the obvious shortcut.

---

## The review's claims

### 1. "Help directs coaches to Playbooks, but Playbooks is absent from the sidebar" — **HALF TRUE, and the half matters**

Help does link there (`help/page.tsx` lines 60, 100–101, 193–201).

But **`app/dashboard/playbooks/page.tsx` exists and is 1,019 lines of working
feature** — templates, sessions, progress, drill video lookup, the lot. It reads
`player_playbooks` and `playbook_templates`, both live tables, and the player
profile still renders an "Active Playbooks" card from them.

So Playbooks is not gone. It is **orphaned**: reachable by URL, invisible in
navigation. Deleting the help article would be wrong — it would hide a feature
some coach may have players enrolled in. The honest fix is to stop sending
people to a sidebar entry that does not exist, describe what Playbooks is and
where it sits relative to the newer systems, and flag the navigation gap as a
product decision for the user rather than silently making it.

### 2. "Help search matches titles only" — **TRUE**

`help/page.tsx:545`:

```ts
article.title.toLowerCase().includes(searchQuery.toLowerCase())
```

A coach searching "screenshot" finds nothing, though roster import is documented.

### 3. "Help claims every drill has a video" — **TRUE**

`help/page.tsx:253`: *"Every drill in the system, with a video demonstration…"*

False twice over. Phase 2H measured it: of the 44 drill slots in the Speed &
Agility pathway, **10 carry a video and none is verified**. Coach-authored
drills have no video at all.

### 4. "Onboarding collects season, team and players, then redirects to the dashboard" — **TRUE**

`onboarding/page.tsx:233` — `router.push('/dashboard')`. The coach lands on
Skill Development with no team priorities, no plans and no next step.

### 5. "Newer features lack dedicated help articles" — **TRUE, and broader than stated**

Articles exist for practice plans, roster, drill library, CoachAI, game day,
notes and playbooks. **Nothing** for: Skill Development / priorities,
development pathways, player reports, pitch counter, lineups, scouting, stats,
AI memory, staff, league, swing analysis, or recap.

### 6. "Useful contextual explanations already exist" — **TRUE**

`PlanCards.tsx:214`, `PrioritiesBoard.tsx:507`, `DrillReview.tsx:234` and the
development empty states carry genuinely good prose in the product's voice. The
brief's instruction to reuse rather than replace is correct; these are the tone
reference.

---

## What the review missed

### 7. `coach_preferences` is AI MEMORY. Do not put dismissal flags in it.

This is the finding that changes the design. The table looks like exactly the
right home for UI preferences — `(coach_id, key, value)`, already has RLS,
already has grants:

```sql
CREATE TABLE public.coach_preferences (id, coach_id, key, value, updated_at);
```

It is not. `app/api/chat/route.ts:88` loads it into the CoachAI prompt as the
coach's remembered preferences, and `app/dashboard/memory/page.tsx:72` renders
it as the **AI Memory** page. Writing `help.practice.dismissed = true` there
would put implementation flags in front of a coach as something the AI has
learned about them — precisely what §6 forbids.

Two further reasons it is the wrong table:

- It is keyed on `coach_id`. `lib/authz.ts` is explicit that an invited
  assistant may have no coach row — so the users §8 most wants guided would
  silently fail to save a dismissal.
- Its write policies use `bc_coach_at_least(coach_id, 'decide')`, which is the
  broken role vocabulary from the Phase 2H closeout, and `anon` holds full
  grants on it.

**Decision: a new table keyed on `auth.uid()`.** Smallest thing that works for
everyone, with RLS that actually constrains.

### 8. There is no support or contact destination anywhere

No `mailto:`, no support address, no ticketing, in any route or component. §4
says to report this rather than fabricate one, so the Help Center will say what
is true — that there is no support inbox yet — instead of inventing an address
that bounces.

### 9. The save control is not called Save

`practice/page.tsx:1477` — the button that saves a generated plan reads
**"Use this plan"**. A guide that says "click Save" would be wrong on the one
step that matters most, and is exactly the error §6 warns about.

Other exact labels, captured rather than assumed: **Generate with AI**, **Start
from a template**, **Create Custom**, **Generate Practice Plan**, **Swap Drill**,
**Log Recap**, **Edit**, **Print**, **One page**, **Add Player**, **Import from
Screenshot**, **Make this the priority**.

### 10. Printing genuinely requires saving first

`Print` and `One page` are links to `/dashboard/practice/{plan.id}/print`. There
is no plan id until the plan is saved, so §5's "save it, with printing offered
afterward" is not a UX preference — it is what the code allows. The guide can
state it as a fact.

---

## The distinctions the guides must get right

§0 asks for these to be explained accurately and not merged. They are four
different systems:

| | What it answers | Scope | Where it lives |
|---|---|---|---|
| **CoachAI priorities** | "What is going wrong right now?" | One team, one problem at a time | `prescriptions`, Skill Development board |
| **Development pathways** | "What do I teach first, next, later?" | One player, curated 10-stage curriculum | `development_pathway*` + `player_pathway_progress` |
| **Practice plans** | "What are we doing on Tuesday?" | One session, whole team | `practice_plans` |
| **Playbooks** | "Give me a multi-week template to follow" | One player, fixed template | `player_playbooks` (orphaned from nav) |

The one most easily confused: a **priority** is a reaction to an observation and
is disposable; a **pathway** is a long-lived sequence a player is enrolled in.
Phase 2H's migration 072 header makes the same distinction and the guides will
use its language.

---

## What this means for the build

1. New table for UI preferences, keyed on the user, not the coach.
2. One content registry, consumed by both the in-module card and the Help
   article, so the two cannot drift.
3. Search over body text and synonyms, not titles.
4. Correct the video claim; keep the coaching resources, label them as coaching
   advice rather than product instructions.
5. Say what is true about Playbooks and about support.
6. Onboarding ends at a **saved practice plan**, detected from
   `practice_plans`, not from a button press.
