// Generates docs/speed-program/COACH-REVIEW.md from the template, so the
// document a coach approves can never drift from what the app prescribes.
//
//   npx tsx scripts/speed-program/gen-review.ts          write the file
//   npx tsx scripts/speed-program/gen-review.ts --check  fail if it is stale

import { readFileSync, writeFileSync } from 'fs'
import { LEVEL_DEFS, SESSION_KEYS, EXERCISE_BY_KEY, PROGRESSIONS, WEEKS, LEVEL_UP_REQUIRES, type LevelKey, type Prescription } from '../../lib/speedProgram/template'
import { restText } from '../../lib/speedProgram/rules'

const OUT = 'docs/speed-program/COACH-REVIEW.md'
const dose = (p: Prescription) => `${p.sets} × ${p.reps}${p.repsLabel && p.repsLabel !== 'reps' ? ` ${p.repsLabel}` : ''}`
const rest = (p: Prescription) => restText(p.rest, p.restNote).replace(/\|/g, '/')
const gate = (p: Prescription) => [p.optional ? 'optional' : '', p.gate ? `unlock: ${p.gate}` : '', p.outdoorOnly ? 'outdoor' : ''].filter(Boolean).join(', ') || '—'

function table(level: LevelKey) {
  const dev = LEVEL_DEFS.development.sessions, cur = LEVEL_DEFS[level].sessions
  const lines: string[] = []
  for (const k of SESSION_KEYS) {
    lines.push(`#### ${cur[k].title}`, '', '| Exercise | Proposed dose | Rest | Gate | Development (source) | Approve |', '|---|---|---|---|---|---|')
    for (const p of cur[k].items) {
      const d = dev[k].items.find(x => x.exercise === p.exercise)!
      const same = dose(p) === dose(d)
      lines.push(`| ${EXERCISE_BY_KEY[p.exercise].name} | ${dose(p)} | ${rest(p)} | ${gate(p)} | ${same ? 'same' : dose(d)} | ☐ |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function level(l: LevelKey, assumptions: string[]) {
  const d = LEVEL_DEFS[l]
  return `## ${d.label}

**Status:** ${d.review === 'draft' ? 'DRAFT: derived by rule from the Development source, not written by a coach. Needs approval.' : 'source'}
**Advisory fit (never a gate):** ${d.typicalFit}
**Sessions per week:** ${d.sessionsPerWeek} · **Length:** ${d.minutes}
**Dose statement shown to the coach:** ${d.dose}
**Readiness text shown:** ${d.readiness}

Rules the source states for this level (shown in the app as-is):
${d.adaptations.map(a => `- ${a}`).join('\n')}

${table(l)}
### What I derived, and what I assumed (${d.label})

${assumptions.map((a, i) => `${i + 1}. ${a}  ☐ approve  ☐ change: ________`).join('\n')}
`
}

const foundation = level('foundation', [
  'One set of every movement. The source says "1 set for each movement"; I applied it to the warm-up-excluded list mechanically.',
  'Starts are 2–3 per exercise. Applied to: falling start, 10-yard acceleration, cone reaction chase, shuffle-plant-accelerate, half-circle cut.',
  'Any other rep count above 4 is capped at 4 (the source says 2–4 reps per drill). Example: wall drive 5 per leg becomes 4.',
  'Rest times are unchanged from Development (the source gives none for Foundation). A younger child may need more; the coach can adjust per player.',
  'PROVISIONAL SAFETY DEFAULT: hops are locked at this level and cannot be unlocked here. The skater exercise stays a step-and-stick, and the jump into a sprint stays hidden, until the player is moved to Development. (The source says "a step instead of a hop"; locking the unlocks is my conservative reading.)',
  '"Not timed, not a race" is written into the 10-yard note, and timed baselines are refused for Foundation (movement-quality rubric only).',
  'Foundation runs session A plus B or C alternating (two a week). The source says "alternating A and B/C"; the exact alternation (A,B then A,C) is mine.',
  'No age is used to place a child. If a six-year-old is placed in Development, the app allows it. Confirm that is the intent.',
])

const advanced = level('advanced', [
  'PROPOSED, pending coach approval: Advanced uses Development\'s repetition counts exactly, with more recovery, instead of the source\'s "4–6 quality short reps". The source also says "do not add volume just because the athlete is older"; the owner chose that cautious reading.',
  'Rest is Development\'s plus 15 seconds on every timed rest (for example the wall drive goes from 30 to 45 sec). The source gives no Advanced rest numbers; 15 seconds is my proposal. A coach sets the final rest per player.',
  'Progression at this level comes from the unlocks (reactive partner cues, single-leg hops) and one added complexity at a time, never from extra reps.',
  'I removed two lines from the Advanced text the source mentions: "10–20-yard acceleration" (shown now only as "a coach may extend an outdoor distance; this program does not prescribe it") and "optional supervised resistance work" (removed). No exercise for either exists. Restore, reword or keep removed?',
  'Single-leg hops are an Advanced-only unlock; they appear only as a progression label, not as a prescribed exercise. Which exercise should they replace?',
  'Reactive partner cues are open to every level from Week 2 with two clean sessions.',
  'The "do not stack harder jumps, volume and faster cuts in the same week" rule is enforced as one harder step per week (unlock or level), not by tracking volume.',
  'Level-up needs landing, braking and reaction all observed and all 2 in the last two sessions, and is refused before Week 3 (Learn and Build come first) even with an override. The Week 3 floor is a provisional safety default of mine, not the source.',
])

const progression = `## Progression and safety rules (all levels)

Source weeks: ${WEEKS.map(w => `${w.week} ${w.name}`).join(' → ')}.

| Progression | Needs (last two sessions: observed and scored 2) | Extra conditions | Approve |
|---|---|---|---|
${PROGRESSIONS.map(p => `| ${p.label} | ${p.requires.join(' + ')} | ${[p.outdoorOnly ? 'outdoor only' : '', p.key === 'broad_jump_to_sprint' ? 'Week 3 or later' : '', p.key === 'reactive_partner_cues' ? 'Week 2 or later' : '', p.key === 'single_leg_hops' ? 'Advanced level only' : ''].filter(Boolean).join(', ') || '—'} | ☐ |`).join('\n')}
| Move to the next level | ${LEVEL_UP_REQUIRES.join(' + ')} | not at the highest level | ☐ |
| Move to the next week | no score below 2 where recorded; no high fatigue | two completed sessions since the last advance | ☐ |

Safety assumptions that need a coach's agreement:

1. Two clean sessions are enough evidence to progress. (Source: "demonstrated safe control in two sessions".)  ☐ approve  ☐ change: ________
2. A single reported pain at the most recent session blocks all advancing, with no override, until a pain-free session is logged. The app never asks what the pain was and does not diagnose; it tells the coach to rest and consult a qualified professional if it continues.  ☐ approve  ☐ change: ________
3. A score of 1 (inconsistent) anywhere in the last two sessions blocks advancing but allows a written coach override. A score of 0 or high fatigue reduces the next session's guidance ("do not add intensity").  ☐ approve  ☐ change: ________
4. Games and hard practices count toward three quality high-intensity exposures a week; the suggested sessions are 3 minus that load (minimum 1). The coach may pick more and is warned, not blocked.  ☐ approve  ☐ change: ________
5. Indoor 20×15 ft: only short controlled footwork, jumps, brakes and short reactions. Timed sprints and the broad-jump-into-sprint are outdoor only. See INDOOR-FALLING-START.md.  ☐ approve  ☐ change: ________
6. Scores are the coach's own 0-2 observations of landing, braking and reaction. A blank means "not observed", and a required kind that was never observed blocks advancing rather than counting as passed.  ☐ approve  ☐ change: ________
7. A child's age is never stored; the intake keeps only an optional band (6-8, 9-12, 13+).  ☐ approve  ☐ change: ________
8. A parent or coach supervises and checks the space is clear and level. This is printed on the page but the app cannot verify it.  ☐ approve  ☐ change: ________

Reviewer: ________________  Date: ____________  Decision: ☐ approved as written  ☐ approved with the changes above  ☐ not approved
`

const doc = `# Coach review: Foundation and Advanced levels

**Generated from the template by \`scripts/speed-program/gen-review.ts\`. Do not edit by hand; edit the template and regenerate.**

The Development level is taken from the source specification exactly. Foundation and Advanced are not: the source gives only a few sentences about each, and the rest was derived by mechanical rules that are listed below so they can be checked. Until a coach approves them, the app labels both as drafts. Nothing here has been used with a real player.

Tick each box, write changes in the blank, and sign at the end. Anything not approved is changed in the template and this file is regenerated.

${foundation}
${advanced}
${progression}`

const arg = process.argv[2]
if (arg === '--check') {
  const cur = readFileSync(OUT, 'utf8')
  if (cur !== doc) { console.error(`${OUT} is stale. Run: npx tsx scripts/speed-program/gen-review.ts`); process.exit(1) }
  console.log('coach review document is in sync with the template')
} else {
  writeFileSync(OUT, doc)
  console.log(`wrote ${OUT}`)
}
