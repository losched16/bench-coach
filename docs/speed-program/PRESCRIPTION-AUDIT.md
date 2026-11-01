# Prescription and progression audit: Foundation, Development, Advanced

Audited from the template as it stands (`lib/speedProgram/template.ts`) and the rules
(`lib/speedProgram/rules.ts`). This is an engineering audit against the source specification
and against conservative youth-training norms as I understand them. **It is not a coaching
approval and I am not a qualified coach.** Items marked **HUMAN** need a coach's decision.

## 1. Volume per session (high end of each range, warm-up and optional items excluded)

| Level | Session | High-intensity starts | Jump contacts | Other reps |
|---|---|---|---|---|
| Foundation | A | 6–9 | 0 | 4 |
| Foundation | B | 4–6 | 0 | 6 |
| Foundation | C | 0 | 9 | 2–4 |
| Development (source) | A | 11 | 0 | 10 |
| Development (source) | B | 5 | 0 | 8 |
| Development (source) | C | 0 | 28 | 4–6 |
| Advanced (proposed: same reps as Development, +15 sec rest) | A | 11 | 0 | 10 |
| Advanced (proposed) | B | 5 | 0 | 8 |
| Advanced (proposed) | C | 0 | 28 | 4–6 |

(Before the owner's decision, Advanced applied the source's "4–6 quality reps" literally and reached 12–18 starts in A and 8–12 in B.)

## 2. Findings

| # | Finding | Severity | Action |
|---|---|---|---|
| 1 | Advanced could have raised start reps well above Development (A: 11 to 12–18; B: 5 to 8–12) because the source says both "4–6 quality short reps" and "do not add volume just because the athlete is older". | High | **Decided by the owner, pending coach approval:** Advanced uses Development's repetition counts, with Development's rest plus 15 seconds (a proposal), and progresses through the unlocks, not reps. The "10–20-yard" and "supervised resistance" lines were removed from the app text. Tested. |
| 2 | Foundation could unlock hops and the jump-into-a-sprint by evidence alone. The source says Foundation uses "a step instead of a hop". | Medium | **Fixed; provisional safety default kept by the owner.** Foundation cannot unlock `skater_hop` or `broad_jump_to_sprint`; the player moves to Development first. Tested. |
| 3 | A level change was possible in Week 1 after two clean sessions. | Medium | **Fixed; provisional safety default kept by the owner.** A level change is refused before Week 3, override or not. Tested. The Week 3 floor is my default, not the source's. **HUMAN** to confirm. |
| 4 | Foundation reuses Development's rest times (the source gives none). Younger children may need more. | Medium | **HUMAN.** Coach can adjust per player today; decide the default. |
| 5 | Advanced rest has no number in the source. | Medium | Proposed: Development's + 15 sec. **HUMAN** to set the real numbers. |
| 6 | The source mentions "optional supervised resistance work" and 10–20 yard runs for Advanced. | Low | Removed from the app text. **HUMAN** to decide whether either belongs. |
| 7 | Reaction cue games are open to every level from Week 2 with two clean sessions. | Low | **HUMAN.** Confirm for Foundation. |
| 8 | The weekly cap counts games and hard practices against three quality exposures; the coach may choose more and is warned, not blocked. | Low | Matches the source's intent. **HUMAN** to confirm warn-not-block. |
| 9 | Two clean sessions as the evidence for any advance. Source: "demonstrated safe control in two sessions". | Low | Matches the source. **HUMAN** to confirm for level changes. |

## 3. Rules that are enforced and tested (unchanged by this audit)

- Pain at the most recent session blocks every advance and cannot be overridden.
- A poor-quality or high-fatigue day never raises the next session (guidance says hold or reduce).
- One harder step per week; no stacking of an unlock and a level change in the same week.
- Single-leg hops: Advanced only. Broad jump into a sprint: Week 3 or later, outdoors only.
- Timed tests: not at Foundation, not indoors; home-to-first only on a field; comparisons only under identical conditions, numbers only.
- History is append-only (sessions, assessments, events), cannot be edited or deleted even by the service role, and the plan snapshot is immutable (database triggers, tested on Postgres including a copy of the production schema).
- Permissions: viewer reads; contributor logs; admin assigns, adjusts and advances; non-members get 404.

## 4. What needs a human coach (I have not approved any of it)

1. Findings 1 to 7 above (1, 2 and 3 are provisional defaults awaiting sign-off).
2. The two missing drills and the indoor falling-start substitute (`REVIEW-PACKETS.md`).
3. Every remaining video reference (`REFERENCE-REVIEW.md`): someone must watch each one.
4. The app's wording on pain and stopping ("have a qualified professional look at it if it continues").
5. That a parent or coach supervises and the space is clear. The app prints this and cannot verify it.
