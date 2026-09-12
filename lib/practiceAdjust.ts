// "Give me ten more minutes of hitting."
//
// What the model is told when a coach asks for a change, and what makes
// "blocks you don't mention stay as they are" true rather than hopeful.
//
// THE CHAIN THIS SITS IN
//
// The adjustment prompt asks for the plan back with unmentioned blocks keeping
// the SAME title and the SAME number of minutes. lib/practicePlan.reusableBlock
// then matches on exactly those two fields and carries the already-written
// detail across verbatim. If the instruction drifts, or a block never reaches
// the model at all, reusableBlock stops matching and the coach quietly gets
// four rewrites of the blocks they liked.
//
// WHY THE PLAN GOES AS AN OUTLINE, NOT AS ITS JSON
//
// It used to be sent as `JSON.stringify(plan, null, 1).slice(0, 6000)`. Two
// things wrong with that, measured on realistic blocks with setup, cues,
// instructions and mistakes on them:
//
//   6 blocks   4,359 chars   fits
//   9 blocks   6,498 chars   cut mid-object — the model is handed invalid JSON
//  12 blocks   8,640 chars   three blocks never reach it at all
//
// A block the model cannot see cannot come back with the same title and the
// same minutes, so preservation failed precisely on the long plans where
// losing four blocks of written detail hurts most.
//
// The model does not need the detail to rebuild a skeleton — it needs the
// shape. An outline of title, minutes and type is about thirty characters a
// block, so a twenty-block practice costs six hundred and nothing is ever
// truncated. The detail it is being asked to preserve is preserved by NOT
// regenerating it, which is reusableBlock's job, not the prompt's.

import { PlanBlock, isStationGroup } from './practicePlan'

/** A practice as a list the model can match against, one line per block. */
export function planOutline(title: string | null | undefined, blocks: PlanBlock[] | null | undefined): string {
  const list = blocks || []
  const lines: string[] = []
  if (title) lines.push(`TITLE: ${title}`)

  list.forEach((b, i) => {
    const type = String(b?.type || 'drill')
    lines.push(`${i + 1}. ${b?.title || 'Untitled'} — ${Number(b?.minutes) || 0} min (${type})`)
    // A rotation's stations are named too. They are what a coach means when
    // they say "swap the backhand station", and without them the model has to
    // guess which block that was.
    if (isStationGroup(b)) {
      for (const s of b.stations as PlanBlock[]) {
        lines.push(`     - station: ${s?.title || 'Untitled'} — ${Number(s?.minutes) || 0} min`)
      }
    }
  })

  return lines.join('\n')
}

export interface AdjustmentInput {
  /** The coach's standing notes for this practice — kit, space, last game. */
  specifics?: string | null
  planTitle?: string | null
  blocks?: PlanBlock[] | null
  /** What they just typed into Ask BenchCoach. */
  words: string
}

/**
 * The instruction sent when a coach asks for a change.
 *
 * The same-title-same-minutes sentence is not style. It is the contract
 * reusableBlock matches on, and scripts/test-practice-adjust.ts asserts it is
 * still in here — because the failure when it goes missing is silent and looks
 * like the model simply deciding to reword things.
 */
export function buildAdjustmentPrompt(input: AdjustmentInput): string {
  const specifics = String(input.specifics || '').trim()
  const words = String(input.words || '').trim()

  return [
    specifics,
    specifics ? '' : null,
    'The coach read this plan and asked for a change. This is the plan they read:',
    '',
    planOutline(input.planTitle, input.blocks),
    '',
    `THEIR WORDS: "${words}"`,
    '',
    'Rebuild the plan honouring that. Any block they did not complain about ' +
    'must come back with the SAME title and the SAME number of minutes — ' +
    'that is how its already-written detail is carried across untouched. ' +
    'Change a title or a duration only where they asked you to.',
  ].filter(l => l !== null).join('\n').trim()
}
