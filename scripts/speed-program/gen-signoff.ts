// Generates docs/speed-program/COACH-SIGN-OFF.md, the one packet a coach signs.
// Everything numeric comes from the template, so it cannot drift from the app.
//
//   npx tsx scripts/speed-program/gen-signoff.ts          write
//   npx tsx scripts/speed-program/gen-signoff.ts --check  fail if stale

import { readFileSync, writeFileSync } from 'fs'
import { LEVEL_DEFS, SESSION_KEYS, EXERCISE_BY_KEY, LEVELS, PROGRESSIONS, GUARDRAILS, WEEKS, LEVEL_UP_REQUIRES, type LevelKey, type Prescription } from '../../lib/speedProgram/template'
import { restText } from '../../lib/speedProgram/rules'

const OUT = 'docs/speed-program/COACH-SIGN-OFF.md'
const dose = (p: Prescription) => `${p.sets} × ${p.reps}${p.repsLabel && p.repsLabel !== 'reps' ? ` ${p.repsLabel}` : ''}`
const cell = (s: string) => s.replace(/\|/g, '/')

function levelTable(l: LevelKey) {
  const d = LEVEL_DEFS[l]
  const out: string[] = [
    `### ${d.label}${d.review === 'draft' ? '  (DRAFT, derived; needs your approval)' : '  (from the source specification)'}`,
    '',
    `${d.sessionsPerWeek} sessions a week · ${d.minutes} · ${d.dose}`,
    `Ready when: ${d.readiness}`,
    '',
  ]
  for (const k of SESSION_KEYS) {
    out.push(`**${d.sessions[k].title}**`, '', '| Exercise | Sets × reps | Rest | Cue | Notes | OK |', '|---|---|---|---|---|---|')
    for (const p of d.sessions[k].items) {
      const e = EXERCISE_BY_KEY[p.exercise]
      const notes = [p.optional ? 'optional' : '', p.gate ? `locked until "${p.gate}"` : '', p.outdoorOnly ? 'outdoor' : '', p.indoorSubstitute ? `indoors: ${p.indoorSubstitute}` : '', p.note || ''].filter(Boolean).join(' · ')
      out.push(`| ${e.name} | ${dose(p)} | ${cell(restText(p.rest, p.restNote))} | ${cell(e.cue)} | ${cell(notes) || '—'} | ☐ |`)
    }
    out.push('')
  }
  return out.join('\n')
}

const refs = LEVELS.length && Array.from(new Map(
  SESSION_KEYS.flatMap(k => LEVEL_DEFS.development.sessions[k].items.map(p => EXERCISE_BY_KEY[p.exercise])).map(e => [e.key, e])).values()
).map(e => `| ${e.name} | ${e.references.map(r => `${r.creator}: ${r.title} <${r.url}>`).join('<br>') || '—'} | ${e.drillMap.name ? `${e.drillMap.name} (${e.drillMap.match})` : 'none'} |`).join('\n')

const doc = `# Coach sign-off packet: Speed, Agility & Explosiveness

**Generated from the app's template by \`scripts/speed-program/gen-signoff.ts\`. Do not edit by hand.**
One packet, one signature. Everything here is a *coaching draft for your approval*. Nothing has been used with a
real player, and nothing here is evidence of results.

**Source.** Development numbers are the specification's own (Notion: "Speed, Agility & Explosiveness — Reusable
Youth Baseball Development Pathway"). Foundation and Advanced are derived from that page's stated rules by
mechanical steps (listed in COACH-REVIEW.md). Video links are third-party Instagram posts, credited to their
creators and shown in the app as "not yet reviewed". They are references, not BenchCoach content.

## A. The four weeks

${WEEKS.map(w => `- **Week ${w.week}, ${w.name}.** ${w.focus} ${w.effort}`).join('\n')}

## B. Safety rules that apply to every level

${GUARDRAILS.map(g => `- ${g}`).join('\n')}

Progression gates: ${PROGRESSIONS.map(p => `${p.label} (${p.requires.join(' + ')}${p.outdoorOnly ? ', outdoor only' : ''})`).join('; ')}; next level (${LEVEL_UP_REQUIRES.join(' + ')}). To advance, the last two completed sessions
must show a score of 2 on everything observed, with no high fatigue; pain at the most recent session blocks advancing with no override; a coach may
override a *non-pain* block with a written reason. One harder step a week.

## C. Doses

Compare Foundation and Advanced with Development row by row; the Approve boxes are yours.

${LEVELS.map(levelTable).join('\n')}

## D. Assumptions I am asking you to accept or change

| # | Assumption | Accept | Change |
|---|---|---|---|
| 1 | Foundation: one set everywhere, starts 2–3, other reps capped at 4, rest as Development, no timed tests. | ☐ | |
| 2 | Advanced: start-type exercises 4–6 quality reps, no added sets, rest "at least Development's; coach sets it". | ☐ | |
| 3 | Foundation runs two sessions a week (A then B, then A then C). | ☐ | |
| 4 | Advanced adds no exercise: the source mentions 10–20 yard runs and supervised resistance work, shown as text only. | ☐ | |
| 5 | Two clean sessions are enough to advance a week, unlock a progression or change level. | ☐ | |
| 6 | A single reported pain blocks advancing until a pain-free session is logged. | ☐ | |
| 7 | Age is advisory only; a coach may place any player in any level. | ☐ | |
| 8 | Games and hard practices reduce the suggested dedicated sessions (3 minus that load, minimum 1). | ☐ | |

## E. The two exercises with no library drill

Full draft write-ups are in DRILL-DRAFTS.md. They are **not** in the drill library and have **no video**.

| Draft | In one line | Safety stop | Approve |
|---|---|---|---|
| Skater Step and Stick | Step sideways, land on the outside foot, hold two quiet seconds; no hop until two sessions of controlled landings. 2 × 3 each side, 45–60 s rest. Cue: "step, soften, hold". | Knee collapses inward or any knee/ankle/hip pain. | ☐ as written ☐ edit ☐ no |
| Half-Circle Cut — Round the Cones | Three cones in a shallow arc, plant the outside foot and push at each. 2 each direction, 45–60 s rest. Cue: "plant, push, up". | Slipping, skidding, or knee/ankle pain; 70–85% effort in week one. | ☐ as written ☐ edit ☐ no |

## F. The indoor substitute (20 × 15 ft)

- 10-yard acceleration indoors: *${LEVEL_DEFS.development.sessions.A.items.find(p => p.exercise === 'accel_10')!.indoorSubstitute}* (the specification's own text).
- Falling start indoors (my proposal, replaces an unsafe 5-yard start in a 15 ft side): *${LEVEL_DEFS.development.sessions.A.items.find(p => p.exercise === 'falling_start')!.indoorSubstitute}*
- Not allowed indoors: full 10-yard sprints, home-to-first tests, the broad-jump-into-sprint.
- The 2 yards and 10 ft clear are my numbers, not the source's. ☐ approve ☐ edit: ______ ☐ use the wall-drive fallback only

## G. Where each exercise comes from

| Exercise | Third-party reference(s) shown in the app (unreviewed) | Library drill it maps to |
|---|---|---|
${refs}

## H. Sign-off

Name: ______________________   Role/credentials: ______________________   Date: ____________

☐ Approved as written  ☐ Approved with the edits marked above  ☐ Not approved

I have / have not (circle) watched each linked video. I understand the app labels them "not yet reviewed" until I tell the
team to remove or replace any.
`

if (process.argv[2] === '--check') {
  if (readFileSync(OUT, 'utf8') !== doc) { console.error(`${OUT} is stale. Run: npx tsx scripts/speed-program/gen-signoff.ts`); process.exit(1) }
  console.log('sign-off packet is in sync with the template')
} else { writeFileSync(OUT, doc); console.log(`wrote ${OUT}`) }
