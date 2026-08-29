# Drill library coverage and data quality

Discovery pass, 29 Aug 2026.

**The per-field counts are not in this file.** They require the live records,
and this audit ran from the repository. Produce them with:

```bash
node scripts/drill-audit.mjs coverage
```

Read-only. What follows is what the *schema* can and cannot hold, which is the
half that no amount of data will change.

---

## Concept coverage — schema level

The audit brief listed the concepts a good recommendation system needs. Here is
which of them `drill_resources` has a home for. **`NO COLUMN` means the concept
cannot be stored at all today, regardless of how well the library is filled
in.**

### Identity
| Concept | Column |
|---|---|
| Drill ID | `id` |
| Name | `drill_name` |
| Slug | **NO COLUMN** |
| Description | `description` |
| Instructions (step-by-step) | **NO COLUMN** — `ai_coaching_notes` is prose, not steps |

### Skill taxonomy
| Concept | Column |
|---|---|
| Sport | **NO COLUMN** (single-sport product) |
| Skill category | `skill_category` |
| Sub-skill | **NO COLUMN** |
| Primary skill trained | `skill_category` (doubles as this) |
| Secondary skills trained | **NO COLUMN** |
| Specific problem addressed | `common_flaws_fixed[]` + `drill_problem_map` |
| Game situation | **NO COLUMN** |

### Player fit
| Concept | Column |
|---|---|
| Min / max age | `min_age`, `max_age` |
| Age group | `age_range` (text), `age_relevance[]` |
| Skill level / difficulty | `difficulty_level` |
| Prerequisite skills | **NO COLUMN** |
| Individual / partner / group / team | **NO COLUMN** |
| Min players | **NO COLUMN** |
| Max players | **NO COLUMN** |
| Ideal player count | **NO COLUMN** |

### Operational requirements
| Concept | Column |
|---|---|
| Coaches / helpers required | **NO COLUMN** |
| Equipment | `equipment_needed[]` (no counts) |
| Space requirements | **NO COLUMN** |
| Indoor / outdoor | **NO COLUMN** |
| Recommended duration | `est_duration_minutes` |
| Reps | `reps_guidance` (text) |
| Sets | **NO COLUMN** |
| Work / rest structure | **NO COLUMN** |
| Frequency | `frequency_guidance` |

### Practice-plan role
| Concept | Column |
|---|---|
| Warm-up / teaching / repetition / station / game / assessment / conditioning / cooldown | **NO COLUMN — none of these exist** |

The practice generator emits `type: "warmup\|drill\|station\|game\|cooldown"`
per block, so the *vocabulary* exists in the prompt. **It is not a property of a
drill**, so the model assigns a role by inference every time.

### Coaching intelligence
| Concept | Column |
|---|---|
| Coaching cues | `ai_coaching_notes` (single prose blob, not a list) |
| Teaching points | **NO COLUMN** |
| Common mistakes | **NO COLUMN** |
| Corrections | **NO COLUMN** |
| Progressions | **NO COLUMN** — `progression_level` is an ordinal, not a link |
| Regressions | **NO COLUMN** |
| Safety notes | `safety_notes` |
| Use this drill when… | **NO COLUMN** |
| Avoid this drill when… | `do_not_coach_note` (partial) |
| Success markers | `success_markers[]` |

Note the asymmetry: the practice generator *produces* `coaching_cues[]`,
`common_mistakes[]`, `drill_variations` and `success_indicators[]` per block
(`lib/anthropic.ts:869`), and the SEO resource layer stores exactly these
fields per drill (`lib/seoResource.ts` `SeoDrill`). **The library itself stores
none of them as structured fields.** The app repeatedly generates coaching
intelligence it cannot save back.

### Retrieval metadata
| Concept | Column |
|---|---|
| Tags | **NO COLUMN** |
| Keywords / search terms | **NO COLUMN** |
| Embedding text | **NO COLUMN** |
| Vector ID | **NO COLUMN** |
| Categories | `skill_category` |
| Recommendation weights | **NO COLUMN** — `drill_problem_map.sort_order` is per-problem ordering, the nearest thing |

**There is no vector search anywhere in the codebase.** Verified by grep for
`embedding`, `pgvector`, `vector(`, `cosine`, `<=>` across `lib/`, `app/` and
`migrations/`: zero hits.

### Relationships
| Concept | Where |
|---|---|
| Practice plans using the drill | Not modelled — plans store `drill_name` / `youtube_video_id` as text in `content` JSONB, **not a foreign key** |
| Playbooks / development plans | `plan_sessions` (migrations 023/035/036) reference drills |
| Related drills | **NO COLUMN** |
| Progression drill (next) | **NO COLUMN** |
| Regression drill (easier) | **NO COLUMN** |

The practice-plan link is worth stating plainly: **you cannot currently ask
"which practices used this drill"** without string-matching names in JSON.

## What the script measures

`node scripts/drill-audit.mjs coverage` reports, for every concept above that
has a column, how many drills carry a non-empty value — and prints `NO COLUMN`
for the rest, so the two kinds of gap stay visually distinct.

It also reports:

- **Identical normalised drill names** — exact duplicate detection
- **Shared `youtube_video_id`** — near-duplicate detection. One video legitimately
  teaching two drills is fine; it is also where accidental duplicates hide
- **Weak metadata by category** — drills missing ≥4 of the six fields that
  actually drive retrieval (`common_flaws_fixed`, `mechanic_focus`,
  `est_duration_minutes`, `equipment_needed`, age bounds, `ai_coaching_notes`),
  grouped by `skill_category`

That last table is the "lots of drills, weak metadata" question: a category with
many rows and a high weak count is a category where the library looks healthy in
a count and performs badly in retrieval.

## Existing tooling

`migrations/DIAGNOSE_DRILL_LIBRARY.sql` already answers several of these
questions in SQL and is safe on production (read-only). It covers status
breakdown, progression-metadata gaps, problem-mapping coverage and video reuse.
Its header notes that if BLOCK B errors on an unknown column, that error names
the unapplied migration.

`migrations/CHECK_SCHEMA.sql` reports which migrations 012–041 are applied —
worth running first, since several columns discussed here may not exist in
production yet.

## Distinguishing stored from inferred

Everything in this document is derived from schema definitions and source code
in this repository. **No drill values were inferred and none are presented as
stored.** The CSV and JSON produced by `scripts/drill-audit.mjs export` are
verbatim database rows; the only added keys are prefixed `_joined_`, which the
export's own `note` field explains are from `drill_problem_map` /
`problem_taxonomy` rather than columns on the drill.
