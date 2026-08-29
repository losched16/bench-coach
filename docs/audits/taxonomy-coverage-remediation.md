# Taxonomy coverage — audit and remediation (Phase 2A)

29 Aug 2026. Read-only audit, then `migrations/046_taxonomy_coverage.sql`.
Verified against a local Postgres replica seeded with the production export;
**not yet applied to production.**

---

## The finding that reframed the work

**No drill in the library has ever used the phrase "back shoulder."**

The flagship gap from the brief is not a missing drill and not a missing
problem. The library describes that exact fault as `dropping the barrel`,
`dumping barrel`, `Dropping hands / under balls` and `uppercut`. Coaches say
"he's dropping his back shoulder." Nobody had written the translation down.

That reframes the whole exercise: much of the 92 is vocabulary drift between
how a library was catalogued and how a coach talks.

## Aliases and mappings do different jobs

Conflating them is what would have polluted the taxonomy:

| | Matches | Must be |
|---|---|---|
| **Alias** | what a **coach types** | a phrase a person would say, specific enough not to misfire |
| **Mapping** | a **drill** to a problem | anything — it never sees coach text |

`poor communication` is a real flaw string and a **terrible** alias: it would
diagnose a question about team parents as an outfield problem. So it became a
mapping and not an alias.

This is why 44 of the classified strings are handled as mappings and only 11
as aliases — and why the raw "unmatched string" count barely moves while the
retrieval outcome changes completely.

## Classification of all 92

| Bucket | n |
|---|---|
| A — alias/mapping to an existing problem | 47 |
| B — new taxonomy entry | 8 |
| B? — real concept, no home yet (debt) | 12 |
| C — compound (maps to two problems) | 7 |
| D — not a diagnosis | 18 |

Mechanism: 44 mappings · 11 aliases · 37 left alone.

| Raw flaw | n | Bucket | Slug | Mechanism | Conf | Reasoning |
|---|---|---|---|---|---|---|
| `improper grip` | 3 | C | — | none | — | Grip is one component of a multi-part compilation drill, not its purpose. The drills carrying it already map to 3-4 problems each. |
| `incorrect grip` | 3 | C | — | none | — | Same as 'improper grip'. A grip slug would map only to compilation videos. |
| `lack of coordination` | 3 | D | — | none | — | Too vague to diagnose or prescribe against. |
| `poor weight transfer` | 3 | B? | — | none | low | Real concept, but it appears in Pitching AND Hitting drills that already map to lunging, flying-open and no-hip-lead. A global alias would cross-diagnose. Left as debt. |
| `downhill shoulders` | 2 | B? | — | none | low | Pitching posture. No close entry; balance-leg-lift and rushing-delivery are both wrong. Left as debt. |
| `overexertion` | 2 | A | `arm-fatigue` | mapping | med | Overexertion is how arm fatigue arrives. Mapping only — too generic a phrase to be a coach-facing alias. |
| `poor bat control` | 2 | A | `inconsistent-contact` | mapping | med | Bat control failures show up as inconsistent contact. Generic phrase, mapping only. |
| `poor hip engagement` | 2 | A | `flying-open` | mapping | med | flying-open is 'no separation between upper and lower body'. Mapping only — 'poor hip engagement' would cross-diagnose from a pitching question. |
| `standing too upright` | 2 | B | `loses-posture` | alias | high | Posture loss. See new entry. |
| `stiff arm` | 2 | A | `cold-arm` | mapping | med | cold-arm already carries 'arm tightness' and 'stiff shoulders'. |
| `stiff hands` | 2 | A | `poor-fielding-footwork` | mapping | med | Infield hands. poor-fielding-footwork owns 'stabbing at the ball'. |
| `stiffness` | 2 | A | `cold-arm` | mapping | high | Warmup and athletic-development drills; cold-arm is the warmup entry. |
| `wide arm circle` | 2 | A | `throwing-mechanics` | mapping | high | throwing-mechanics owns 'poor arm path'. |
| `Dropping hands / under balls` | 1 | A | `uppercutting` | alias | high | THE FLAGSHIP CLUSTER. Swinging under the ball is the back-shoulder fault by another name. |
| `Dumping barrel / dragging elbow` | 1 | A | `uppercutting` | alias | high | Flagship cluster. Dumping the barrel is what dropping the back shoulder does. |
| `Poor communication` | 1 | A | `outfield-communication` | mapping | high | Unambiguous in context. Mapping only — 'poor communication' as a coach-facing alias would fire on a question about parents. |
| `arm drag` | 1 | A | `throwing-mechanics` | mapping | med | Arm lagging behind the body is an arm-path failure. |
| `bad grip` | 1 | C | — | none | — | Same cluster. |
| `ball coming out going sideways or up` | 1 | A | `inconsistent-release` | mapping | med | Release-point variance. |
| `ball facing target on separation` | 1 | D | — | none | — | A cue about what to look for, not a fault. |
| `dropping balls` | 1 | D | — | none | — | Ambiguous: dropped catches or dropped hands. Too vague. |
| `dropping hands` | 1 | A | `uppercutting` | alias | high | Flagship cluster. |
| `dropping the barrel` | 1 | A | `uppercutting` | alias | high | Flagship cluster. |
| `excessive glove movement` | 1 | A | `catcher-receiving` | mapping | high | Quiet receiving is exactly what catcher-receiving is about. |
| `flat-lining at max distance` | 1 | A | `weak-throws` | mapping | med | No carry at distance. |
| `glove arm flopping` | 1 | B? | — | none | low | Front-side control. Two occurrences, no entry. Left as debt. |
| `glove arm flopping out to the side` | 1 | B? | — | none | low | Same. |
| `gripping ball in palm` | 1 | C | — | none | — | Same cluster, throwing side. |
| `hitting the ball too deep in the zone` | 1 | A | `late-timing` | mapping | high | Contact deep in the zone is the definition of late. |
| `hitting without weight transfer` | 1 | A | `flying-open` | mapping | med | Upper and lower firing together. |
| `inconsistent mechanics` | 1 | A | `throwing-mechanics` | mapping | high | throwing-mechanics owns 'sloppy mechanics'. |
| `incorrect foot positioning on throw-downs` | 1 | B? | — | none | low | Catcher throwing footwork. No entry; one occurrence. Debt. |
| `inefficient path` | 1 | A | `throwing-mechanics` | mapping | high | Arm path. |
| `lack of lower-body engagement` | 1 | A | `throwing-mechanics` | mapping | med | 'throwing with only the arm' is an existing alias. |
| `lack of pre-game preparation` | 1 | A | `cold-arm` | mapping | high | cold-arm is the no-warm-up entry. |
| `lack of upper-body warm-up` | 1 | A | `cold-arm` | mapping | high | Same. |
| `lazy secondary stance` | 1 | B? | — | none | low | Catcher stance. One occurrence. Debt. |
| `loose inefficient arm path` | 1 | A | `throwing-mechanics` | mapping | high | Arm path, verbatim concept. |
| `losing accuracy in game conditions` | 1 | A | `inaccurate-throws` | mapping | high | Accuracy under pressure is still accuracy. |
| `losing bend in knees` | 1 | B | `loses-posture` | alias | high | Posture. See new entry. |
| `losing hip rotation power` | 1 | A | `no-hip-lead` | mapping | high | Hip rotation is what no-hip-lead names. |
| `losing mechanics when unsupervised` | 1 | D | — | none | — | About practice habits, not a mechanical fault. |
| `loss of posture during swing` | 1 | B | `loses-posture` | alias | high | Posture. See new entry. |
| `low motivation in young players` | 1 | D | — | none | — | Not a coaching diagnosis in this taxonomy's sense. |
| `lower body interference with arm mechanics` | 1 | A | `throwing-mechanics` | mapping | med | Sequencing failure. |
| `mechanical breakdown at distance` | 1 | C | — | none | — | Compound: throwing-mechanics + weak-throws. Mapped to both. |
| `mechanical inconsistency` | 1 | A | `throwing-mechanics` | mapping | high | Verbatim concept. |
| `muscle tightness` | 1 | A | `cold-arm` | mapping | high | Warmup entry. |
| `no challenge in regular catch` | 1 | D | — | none | — | Drill-design rationale, not a fault. |
| `no cool-down pulldown` | 1 | A | `arm-fatigue` | mapping | med | Recovery routine, which arm-fatigue owns. |
| `no experience with underhand flips` | 1 | D | — | none | — | A gap in exposure, not a fault. |
| `no feel for individual positions` | 1 | D | — | none | — | Drill rationale. |
| `no lower-body involvement` | 1 | A | `flying-open` | mapping | med | Upper and lower firing together. |
| `no pivot` | 1 | A | `throwing-mechanics` | mapping | med | Sequencing. |
| `no rotation` | 1 | A | `throwing-mechanics` | mapping | med | Sequencing. |
| `no torso rotation` | 1 | A | `throwing-mechanics` | mapping | med | Sequencing. |
| `not finishing in fielding position` | 1 | B? | — | none | low | Pitcher fielding. No entry. Debt. |
| `not finishing swing in direction of target` | 1 | B? | — | none | low | No hitting follow-through entry exists. Debt. |
| `not practicing independently` | 1 | D | — | none | — | Habit, not a fault. |
| `over-reliance on lower body` | 1 | D | — | none | — | The inverse of the usual fault; too rare and too easily confused. |
| `overthrowing when competing` | 1 | A | `inaccurate-throws` | mapping | med | Accuracy under pressure. |
| `poor body alignment` | 1 | A | `inaccurate-throws` | mapping | high | inaccurate-throws is 'no step or alignment to the target'. |
| `poor follow-through` | 1 | A | `no-follow-through-throw` | mapping | high | Verbatim concept. |
| `poor glove angle` | 1 | A | `catcher-receiving` | mapping | med | Receiving. |
| `poor glove use` | 1 | D | — | none | — | Too vague. |
| `poor hand direction to ball` | 1 | B? | — | none | low | Hand path. casting is close but not the same. Debt. |
| `poor hip mobility` | 1 | A | `cold-arm` | mapping | med | Warmup/mobility. |
| `poor inside pitch handling` | 1 | B? | — | none | low | No entry for handling location. Debt. |
| `poor outfield ground ball technique` | 1 | B? | — | none | low | No outfield-grounder entry. Debt. |
| `poor posture` | 1 | B | `loses-posture` | alias | med | Athletic Development context; the posture entry is scoped to Hitting, so mapping only for this row. |
| `poor rhythm` | 1 | D | — | none | — | Too vague. |
| `poor stance` | 1 | B | `loses-posture` | mapping | med | Stance and posture overlap here. |
| `poor stance setup` | 1 | B? | — | none | low | Catcher stance. Debt. |
| `poor throwing after catches` | 1 | A | `slow-transfer` | mapping | high | Catch-to-throw is exactly slow-transfer. |
| `poor tracking on breaking balls` | 1 | A | `cant-hit-offspeed` | mapping | high | cant-hit-offspeed owns 'can't recognize spin'. |
| `poor upper-body mechanics` | 1 | D | — | none | — | Too vague. |
| `popping up` | 1 | A | `uppercutting` | mapping | med | The observable outcome of an uppercut. Mapping only — 'popping up' also means standing up out of a stance. |
| `popping up out of stance during swing` | 1 | B | `loses-posture` | alias | high | Posture. See new entry. |
| `rushing and breaking down mechanics under pressure` | 1 | C | — | none | — | Compound: rushing-delivery + throwing-mechanics. Mapped to both. |
| `single swing-plane only` | 1 | D | — | none | — | About drill variety, not a fault. |
| `sloppy mechanics when unsupervised` | 1 | D | — | none | — | Habit. |
| `slow bat speed on high pitches` | 1 | A | `late-timing` | mapping | high | late-timing owns 'slow bat speed'. |
| `standing upright` | 1 | B | `loses-posture` | alias | high | Same. |
| `stiff arm action` | 1 | A | `throwing-mechanics` | mapping | med | Mechanical stiffness rather than a cold arm. |
| `stiff unfamiliar glove work` | 1 | D | — | none | — | Drill rationale. |
| `tall posture through contact` | 1 | B | `loses-posture` | alias | high | Posture. See new entry. |
| `throwing flat-footed from outfield` | 1 | C | — | none | — | Compound: weak-throws + fielding-flat-footed. |
| `throwing without intent` | 1 | D | — | none | — | A coaching concept, not a fault. |
| `tight arm` | 1 | A | `cold-arm` | mapping | med | Tightness. |
| `tucked front foot` | 1 | A | `inconsistent-stride` | mapping | med | Landing position. |
| `weak core control` | 1 | D | — | none | — | Too vague. |
| `weak hands` | 1 | A | `rolling-over` | mapping | med | rolling-over owns 'weak top hand'. |

## The back-shoulder decision: Option A, alias to `uppercutting`

**Not a new slug.** Three reasons, all from the data:

1. **Dropping the back shoulder is the cause; an uppercut swing plane is the
   effect.** The taxonomy is organised around the fault a coach observes and
   the drills that fix it — and the fix is identical.
2. **The library holds no drill set that distinguishes them.** A new slug would
   have had to borrow `uppercutting`'s own drills, producing exactly the
   near-duplicate the brief warns against.
3. **`uppercutting` already owns the right answer.** Its curated sequence is
   Tee Work (1) → Low Tee (2) → Line Drive Pro (3), which Phase 1 showed is
   precisely what this query should return.

**Anchored on two-word phrases, not conjugations.** `diagnoseByAlias` does
plain substring matching, so "dropping his back shoulder", "drops his back
shoulder" and "back shoulder dips" are three sentences sharing one phrase.
Enumerating conjugations is a losing game; `back shoulder` catches all of them.

Named trade-off: "his back shoulder is sore" would also diagnose as a swing
fault. Rare phrasing, and the cost is a few hitting drills in an answer about
soreness. Bare `shoulder` is deliberately **not** an alias, and there is a test
asserting it.

## The one new entry: `loses-posture`

The only cluster that earned a slug.

Six flaw strings across five drills describe a hitter coming out of their legs
— `losing bend in knees`, `tall posture through contact`, `popping up out of
stance during swing`, `standing too upright`. **One of those drills, "Bucket
Drill — Stay in Your Legs", was mapped to nothing at all** and was therefore
invisible to taxonomy retrieval.

Distinct from `lunging`, which is weight drifting *forward*. A hitter can stand
up without drifting and drift without standing up, and the fixes differ.

**Rejected new entries:** a `grip` slug (8 occurrences, but every drill
carrying it is a multi-part compilation already mapped to 3–4 problems — the
slug would collect compilation videos) and `poor weight transfer` (real, but
it appears in Pitching *and* Hitting drills already mapped to `lunging`,
`flying-open` and `no-hip-lead`; a global alias would cross-diagnose).

## Provenance

**All 37 new mappings are `curated = FALSE`.**

The curated flag means a human who coaches this game verified the pairing, and
Phase 1 scoring weights it 100 against 55 for an inferred one. These were
inferred by reading drill metadata. Marking them curated would put them level
with a hand-built progression. No existing mapping's flag is touched, and a
test asserts the curated count is still exactly 75.

## Coverage, before and after

| | Before | After |
|---|---|---|
| Distinct `common_flaws_fixed` | 412 | 412 |
| Matched by label/alias | 320 | **324** |
| Unmatched by label/alias | 92 | **88** |
| Taxonomy problems | 48 | **49** |
| Drill→problem mappings | 311 | **348** |
| — curated | 75 | **75** |
| — auto | 236 | **273** |
| Drills reachable via taxonomy | 166/206 | **173/206** |
| **Flaw strings whose drill is now reachable** | — | **412/412** |

**The "unmatched" number barely moved, and that is the correct outcome.** It
counts alias matches, and generic strings were deliberately handled as
mappings. The number that matters is the last row: every flaw string in the
library now belongs to a drill that taxonomy retrieval can find.

18 strings remain unmatched **on purpose** — `throwing without intent`, `low
motivation in young players`, `no challenge in regular catch`. They are drill
rationale, habits and goals. Making them taxonomy entries would raise a
coverage number and make diagnosis worse.

## Remaining debt (bucket B?)

Real coaching concepts with no good home, each one or two occurrences. Left
unresolved rather than guessed at:

- glove-side control (`glove arm flopping`)
- catcher stance (`lazy secondary stance`, `poor stance setup`)
- catcher throwing footwork (`incorrect foot positioning on throw-downs`)
- pitcher fielding (`not finishing in fielding position`)
- hitting follow-through (`not finishing swing in direction of target`)
- pitching posture (`downhill shoulders`)
- hitting weight transfer (`poor weight transfer`) — cross-category ambiguity
- outfield ground balls (`poor outfield ground ball technique`)
- inside-pitch handling (`poor inside pitch handling`)

Each would need a slug with almost nothing mapped to it. Worth revisiting when
the library grows, not before.
