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
| Advanced | A | 12–18 | 0 | 10 |
| Advanced | B | 8–12 | 0 | 8 |
| Advanced | C | 0 | 28 | 4–6 |

## 2. Findings

| # | Finding | Severity | Action |
|---|---|---|---|
| 1 | **Advanced raises start reps well above Development** (A: 11 to 12–18; B: 5 to 8–12, up to 2.4 times). The source says Advanced is "4–6 quality short reps and longer recovery" *and* "do not add volume just because the athlete is older". The two sentences pull against each other. I applied the first literally. | **High** | **HUMAN.** Choose: (a) as written; (b) keep Development's rep counts and lengthen rest, adding only reactive complexity. I recommend (b) until a coach has seen it work. Not changed in code. |
| 2 | Foundation could unlock hops and the jump-into-a-sprint by evidence alone. The source says Foundation uses "a step instead of a hop". | Medium | **Fixed.** Foundation cannot unlock `skater_hop` or `broad_jump_to_sprint`; the player moves to Development first. Tested. |
| 3 | A level change was possible in Week 1 after two clean sessions. | Medium | **Fixed.** A level change is refused before Week 3, override or not. Tested. The Week 3 floor is my default, not the source's. **HUMAN** to confirm. |
| 4 | Foundation reuses Development's rest times (the source gives none). Younger children may need more. | Medium | **HUMAN.** Coach can adjust per player today; decide the default. |
| 5 | Advanced rest is Development's as a floor, "coach sets it", with no number. | Medium | **HUMAN.** Provide numbers or accept coach-set. |
| 6 | Advanced adaptations mention "optional supervised resistance work" and 10–20 yard runs. Shown as text only; no exercise exists. | Low | **HUMAN.** Keep, reword or remove the text (liability, age). |
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

1. Findings 1, 3, 4, 5, 6, 7 above.
2. The two missing drills and the indoor falling-start substitute (`REVIEW-PACKETS.md`).
3. Every remaining video reference (`REFERENCE-REVIEW.md`): someone must watch each one.
4. The app's wording on pain and stopping ("have a qualified professional look at it if it continues").
5. That a parent or coach supervises and the space is clear. The app prints this and cannot verify it.
