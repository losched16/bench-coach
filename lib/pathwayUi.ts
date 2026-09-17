// What the pathway picker is allowed to SAY.
//
// lib/developmentPathways.ts is the domain layer: what a stage is, which
// drills serve it, what a coach's constraints allow. This file is the
// presentation layer on top of it — the wording, the badges, the one line that
// explains a thin stage to a coach who has never heard the word "thin".
//
// Separate from the component on purpose, the same way lib/drillFinder.ts is
// separate from DrillFinder.tsx: every rule below is a pure function over data
// and can be asserted without rendering anything.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
//
// Phase 2F's coverage audit classifies stages READY / THIN / GAP. Those are
// our words for our curation state and they mean nothing to a coach standing
// on a field. A stage with two drills is not broken — it is a stage with two
// drills, and the honest thing to tell a coach is what that means for their
// practice, not what it means for our audit.

import type { LoadedPathway, Pathway, PathwayStage } from './developmentPathways'
import { orderedStages } from './developmentPathways'

/** A pathway as the picker needs it — no database rows in the component. */
export interface PathwayOption {
  slug: string
  name: string
  summary: string
  skillCategory: string
  stageCount: number
}

export function toOption(p: Pathway, stageCount: number): PathwayOption {
  return {
    slug: p.slug,
    name: p.name,
    summary: (p.summary || '').trim(),
    skillCategory: (p.skill_category || '').trim(),
    stageCount,
  }
}

/**
 * "10 stages". Singular when it is one, because "1 stages" is the kind of
 * detail that makes a coach trust the rest of the screen less.
 */
export function stageCountLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'No stages yet'
  return n === 1 ? '1 stage' : `${n} stages`
}

/** "Stage 4 of 10". */
export function stageHeading(stageNumber: number, total: number): string {
  return `Stage ${stageNumber} of ${total}`
}

/**
 * How many drills the library has for this stage, under no constraints.
 *
 * Deliberately NOT the feasible count for tonight — that depends on space,
 * players and kit, changes as the coach edits the form, and belongs to the
 * planner. This is the shape of the library, which is a stable fact about the
 * stage and is what the badge is describing.
 */
export function stageDrillCount(p: LoadedPathway | null, stage: PathwayStage | null): number {
  if (!p || !stage) return 0
  return (p.linksByStage.get(stage.id) || []).length
}

/**
 * The one line a stage is allowed to say about how much choice it offers.
 *
 * Returns null for a stage with enough drills to rotate a group through,
 * because a badge on every stage is a badge on no stage.
 *
 * Three is the threshold Phase 2F used for THIN, and it is the right number
 * for a different reason here: three is what a coach needs to run a station
 * twice without repeating themselves. The word "thin" does not appear.
 */
export function stageBreadth(count: number): { label: string; detail: string } | null {
  if (count <= 0) {
    return {
      label: 'No drills yet',
      detail: 'Nothing in the library serves this stage yet. Pick another stage, or build the practice without a pathway.',
    }
  }
  if (count < 3) {
    return {
      label: 'Focused stage',
      detail: count === 1
        ? 'One drill in the library teaches this. Good for a short, sharp block — you will not be rotating a group through it.'
        : 'A couple of drills teach this. Good for a short, sharp block rather than a long station rotation.',
    }
  }
  return null
}

/**
 * The focus chip a pathway implies, or null when none of them fits.
 *
 * The practice form requires at least one focus area and always has. A coach
 * who picks a pathway has told us what they are working on, so making them
 * also tick a chip is asking the same question twice.
 *
 * Slug first, then category. Two pathways share the category "fielding" and
 * mean opposite ends of the field, so the category alone would send an
 * outfield session to the infield. Anything unrecognised returns null and the
 * coach picks for themselves — a wrong guess here quietly mis-builds a
 * practice, which is worse than one more tap.
 */
const FOCUS_BY_SLUG: Record<string, string> = {
  'build-the-swing': 'hitting',
  'infield-fundamentals': 'infield',
  'outfield-development': 'outfield',
  'throwing-development': 'throwing',
  'catching-development': 'catching',
  'baserunning-development': 'baserunning',
  // No 'pitching' chip exists in the practice form. Throwing is the honest
  // neighbour: every pitching stage is throwing work, and the alternative is
  // inventing a focus area, which is a product change this phase is not making.
  'pitching-development': 'throwing',
}

const FOCUS_BY_CATEGORY: Record<string, string> = {
  hitting: 'hitting',
  throwing: 'throwing',
  catching: 'catching',
  baserunning: 'baserunning',
  pitching: 'throwing',
}

export function focusForPathway(
  slug: string | null | undefined,
  skillCategory?: string | null
): string | null {
  const s = (slug || '').trim().toLowerCase()
  if (s && FOCUS_BY_SLUG[s]) return FOCUS_BY_SLUG[s]
  const c = (skillCategory || '').trim().toLowerCase()
  return FOCUS_BY_CATEGORY[c] || null
}

/**
 * Previous and next stage names for the navigator, or null at either end.
 *
 * nextStage() already refuses to invent a stage past the last one. This keeps
 * that honest at the UI layer too rather than re-deriving it from an index.
 */
export function neighbours(
  p: LoadedPathway | null,
  stageNumber: number | null
): { previous: PathwayStage | null; next: PathwayStage | null } {
  const stages = orderedStages(p)
  if (!stages.length || !stageNumber) return { previous: null, next: null }
  const i = stages.findIndex(s => s.stage_number === stageNumber)
  if (i < 0) return { previous: null, next: null }
  return {
    previous: i > 0 ? stages[i - 1] : null,
    next: i < stages.length - 1 ? stages[i + 1] : null,
  }
}

/**
 * A stage number the pathway actually has, or null.
 *
 * A stale URL, a pathway that changed under a refresh, or a coach who was on
 * stage 11 of a pathway that now has 10 — all arrive here. Returning null and
 * letting the caller fall back to stage 1 is better than clamping silently to
 * the last stage, which would put them somewhere they did not choose.
 */
export function resolveStageNumber(
  p: LoadedPathway | null,
  wanted: number | null | undefined
): number | null {
  const stages = orderedStages(p)
  if (!stages.length) return null
  if (wanted == null || !Number.isFinite(wanted)) return stages[0].stage_number
  return stages.some(s => s.stage_number === wanted) ? wanted : null
}

/**
 * What to tell a coach when the stage is real but nothing in it can run today.
 *
 * Never "no drills found". The drills exist; this practice cannot fit them.
 * Saying which constraint did it is the difference between a coach changing
 * one field and a coach giving up on the feature.
 */
export function noFeasibleDrillsMessage(
  stageName: string,
  constraints: { space?: string | null; coachCount?: number | null; playerCount?: number | null }
): string {
  const blame: string[] = []
  if (constraints.space) blame.push(`the space you have (${constraints.space})`)
  if (constraints.coachCount === 1) blame.push('one coach')
  if (constraints.playerCount != null && constraints.playerCount < 4) {
    blame.push(`${constraints.playerCount} players`)
  }
  const because = blame.length
    ? ` Most likely ${blame.join(' and ')}.`
    : ''
  return `The library has drills for ${stageName}, but none of them can run under tonight's constraints.${because} ` +
    `Change a constraint, pick another stage, or build the practice without a pathway.`
}
