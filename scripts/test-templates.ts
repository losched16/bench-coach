// Are the stock templates actually usable?
//
// These are static content, so nothing here can break at runtime — which is
// exactly why it needs a test. A template whose blocks add up to 52 minutes
// under a 60-minute heading is wrong on a printed sheet and nothing anywhere
// complains. A seed that names a focus area the builder does not have silently
// selects nothing. A hard-coded video id survives the drill audit and quietly
// becomes a dead link.
//
//   npm run test:templates

import { PRACTICE_TEMPLATES, templateById, templatePlanContent, OCCASIONS } from '@/lib/practiceTemplates'
import { readPlan, equipmentChecklist, plannedMinutes, scheduleRows } from '@/lib/practicePlan'

// The builder's chips. Kept in step by hand; this test is what catches it when
// somebody renames one.
const FOCUS_OPTIONS = [
  'throwing', 'catching', 'infield', 'outfield', 'hitting',
  'baserunning', 'game IQ', 'confidence', 'focus/behavior',
]
const EQUIPMENT_OPTIONS = [
  'Baseballs', 'Bats', 'Helmets', 'Bases', 'Cones',
  'Gloves', "Catcher's gear", 'L-screen', 'Tee', 'Water', 'First aid kit',
]

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

check('there are templates at all', PRACTICE_TEMPLATES.length > 0)
check('ids are unique', new Set(PRACTICE_TEMPLATES.map(t => t.id)).size === PRACTICE_TEMPLATES.length)
check('lookup by id works', templateById(PRACTICE_TEMPLATES[0].id) !== null)
check('an unknown id returns null, not undefined', templateById('nope') === null)

for (const t of PRACTICE_TEMPLATES) {
  const p = `[${t.id}]`
  const blocks = t.content.blocks

  check(`${p} has a title and description`, Boolean(t.title && t.description))
  check(`${p} has blocks`, blocks.length >= 3, `${blocks.length} blocks`)

  // The heading says 60 minutes; the schedule had better say 60 minutes.
  const total = plannedMinutes(blocks)
  check(
    `${p} block minutes match the stated duration`,
    total === t.duration_minutes,
    `blocks add to ${total}, header says ${t.duration_minutes}`,
  )

  // Every block has to survive the printed sheet, which shows a name, a length
  // and a one-line description in the schedule table.
  for (const b of blocks) {
    check(`${p} "${b.title}" has a title, minutes and a description`,
      Boolean(b.title && b.minutes && b.description))
    check(`${p} "${b.title}" has the detail the sheet prints`,
      Boolean(b.setup && b.detailed_instructions && b.coaching_cues?.length && b.watch_for))
    // The whole reason templates carry no video: the drill library is mid-audit
    // and half of it shares videos. Blocks name their drill and the lookup
    // matches at render time, so a retired drill costs a video, not a dead link.
    check(`${p} "${b.title}" hard-codes no video id`,
      !b.youtube_video_id && !b.youtube_url)
  }

  // The clipboard half.
  check(`${p} has an objective`, Boolean(t.content.objective))
  check(`${p} has exactly 3 coaching points`, t.content.coaching_points.length === 3,
    `${t.content.coaching_points.length}`)
  check(`${p} has coach notes`, Boolean(t.content.coach_notes))
  check(`${p} flags name a problem`, t.content.flags.length > 0)

  // Equipment has to aggregate into something a coach can pack.
  const packed = equipmentChecklist(blocks)
  check(`${p} produces an equipment checklist`, packed.length > 0)

  // The seed has to survive the builder.
  check(`${p} seed duration matches`, t.seed.duration === t.duration_minutes)
  const badFocus = t.seed.focus.filter(f => !FOCUS_OPTIONS.includes(f))
  check(`${p} seed focus areas all exist in the builder`, badFocus.length === 0, badFocus.join(', '))
  check(`${p} seed focus is within the 5 the builder allows`, t.seed.focus.length <= 5,
    `${t.seed.focus.length}`)
  const badKit = t.seed.equipment.filter(e => !EQUIPMENT_OPTIONS.includes(e))
  check(`${p} seed equipment all exists in the builder`, badKit.length === 0, badKit.join(', '))
  check(`${p} seed carries real instructions for the model`, t.seed.specifics.length > 80)
  check(`${p} occasion is one of the filters`,
    OCCASIONS.some(o => o.value === t.occasion), t.occasion)
}

// A copied template has to be indistinguishable from an AI plan downstream —
// same content shape, so the sheet, the plan page and the recap loop all work.
const copied = templatePlanContent(PRACTICE_TEMPLATES[0])
const round = readPlan(copied)
check('a copied template reads back through readPlan', round.blocks.length > 0)
check('a copied template keeps its objective', Boolean(round.objective))
check('a copied template keeps 3 coaching points', round.coaching_points.length === 3)
check('a copied template has no start time until the coach sets one', round.start_time === null)
check('a copied template schedules cleanly', scheduleRows(round.blocks, null)[0].from === '0:00')

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
