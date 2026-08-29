// Which of these drills fit in the time the coach actually has?
//
// WHAT THIS IS NOT
//
// It is not a replacement for the practice generator. BenchCoach does not
// assemble practices in code — the model reads a drill menu and composes the
// blocks, including their lengths, and that is the product. Replacing it with
// a deterministic planner would be rewriting the feature, not migrating it.
//
// So this module does two narrower things, and the split matters:
//
//   1. PROPOSE. Turn a ranked candidate list into an ordered shortlist that
//      fits the drill budget — deduplicated, progression-ordered, built around
//      the strongest taxonomy matches. This is a recommendation handed to the
//      model, not a decision taken from it.
//
//   2. ENFORCE. Read the skeleton the model returns and make the arithmetic
//      true. "Durations must add to about N minutes" was the entire time
//      contract before this, and "about" was doing all of the work — a
//      60-minute request could come back as 72 minutes of blocks and nothing
//      noticed, because nothing was counting.
//
// Enforcement is why this is a module and not a prompt change. A prompt cannot
// promise arithmetic. A pure function that trims the plan can, and can be
// tested at seven budgets without an API key.
//
// WHY DURATION IS NOT IN rankDrills()
//
// Phase 2B proved, with the twenty evaluation prompts run twice, that
// populating est_duration_minutes changes nothing about retrieval — same
// drills, same order, same scores. That property is worth keeping. Retrieval
// answers "which drills are best for this coaching need"; this module answers
// "which of them fit". Blending the two would make a 5-minute drill beat a
// better 15-minute one on relevance, which is not a judgement retrieval should
// ever make.
//
// WHAT THIS DELIBERATELY DOES NOT KNOW
//
// How many kids are standing there. The library has no player count, coach
// count, station count or equipment quantity, and est_duration_minutes is a
// BASE estimate — what one group needs to run the drill once. It is not scaled
// to an assumed roster and must not be. A twelve-player team running one tee
// needs a multiplier on reps, which is a different input with different data
// behind it; guessing at it here would make the stored number mean two things.

import { DrillRecord } from './drills'
import { ScoredDrill } from './drillRetrieval'
import { stageOf } from './progression'

// ---------------------------------------------------------------------------
// The time contract
// ---------------------------------------------------------------------------

/**
 * What a practice spends on things that are not a drill block.
 *
 * NOT a flat overhead constant bolted on top. The generator already produces
 * warm-up and cool-down blocks and the model already gives them minutes, so
 * reserving separate overhead on top of blocks that exist would double-count
 * and shrink every practice.
 *
 * What is genuinely unaccounted for is the seam between blocks: getting eleven
 * eight-year-olds from one station to the next, water, and the thirty seconds
 * of explaining that starts every block. That is per-transition, so it scales
 * with the number of blocks rather than being a fixed tax.
 */
export const TRANSITION_MINUTES = 2

/**
 * A practice is allowed to finish short of its budget.
 *
 * Filling the last four minutes with a weakly relevant drill is worse than
 * handing back a 56-minute plan for a 60-minute request. A coach can always
 * run one more round of something that worked; they cannot un-run a bad drill.
 *
 * Overage is a different matter and is not tolerated at all — see fitBlocks().
 */
export const ACCEPTABLE_SLACK_MINUTES = 8

export interface Budget {
  requested: number
  /** Blocks the practice will spend on warm-up, game, cool-down and the like. */
  nonDrill: number
  /** Reserved for moving between blocks — TRANSITION_MINUTES per seam. */
  transitions: number
  /** What is left for actual drill blocks. Never negative. */
  drillBudget: number
}

/**
 * Split the requested minutes into what is spendable on drills.
 *
 * blockCount is how many blocks the practice is expected to have; the seams
 * between them are what transitions pays for. Before a skeleton exists this is
 * an estimate, and computeBudget is re-run against the real block count once
 * the model has answered.
 */
export function computeBudget(
  requestedMinutes: number,
  opts: { nonDrillMinutes?: number; blockCount?: number } = {}
): Budget {
  const requested = Math.max(0, Math.floor(requestedMinutes || 0))
  const blocks = Math.max(1, opts.blockCount ?? estimateBlockCount(requested))
  const transitions = Math.max(0, blocks - 1) * TRANSITION_MINUTES

  // Warm-up and cool-down scale with the session: a 20-minute backyard session
  // gets a two-minute activation, not the same eight-minute team warm-up a
  // ninety-minute practice earns.
  const nonDrill = opts.nonDrillMinutes ?? defaultNonDrillMinutes(requested)

  return {
    requested,
    nonDrill,
    transitions,
    drillBudget: Math.max(0, requested - nonDrill - transitions),
  }
}

/**
 * Roughly how many blocks a practice of this length carries.
 *
 * Matches what the generator is already told to produce — warm-up, two to four
 * drill blocks, a game, a cool-down — scaled down for short sessions, where a
 * six-block template would leave each block three minutes long.
 */
export function estimateBlockCount(requestedMinutes: number): number {
  if (requestedMinutes <= 25) return 3
  if (requestedMinutes <= 40) return 4
  if (requestedMinutes <= 60) return 5
  if (requestedMinutes <= 90) return 6
  return 7
}

/**
 * Minutes the practice owes to non-drill blocks.
 *
 * A short session still needs an activation and a word at the end, but it
 * cannot afford a full warm-up and a competitive game on top of the two drills
 * that are the entire point of it.
 */
export function defaultNonDrillMinutes(requestedMinutes: number): number {
  if (requestedMinutes <= 25) return 6    // brief activation + recap
  if (requestedMinutes <= 40) return 9    // warm-up + recap
  if (requestedMinutes <= 60) return 14   // warm-up + short game + cool-down
  if (requestedMinutes <= 90) return 20
  return 25
}

// ---------------------------------------------------------------------------
// Redundancy
// ---------------------------------------------------------------------------

const norm = (s: any) =>
  String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Are these two drills the same activity wearing different names?
 *
 * Conservative on purpose, because the expensive mistake here is suppressing a
 * real progression. 103 of the 206 drills share a video with something else,
 * and most of those are legitimately distinct segments of one compilation —
 * "Tee Work", "Low Tee" and "High Tee" all come off the same film and a coach
 * running all three is running a progression, not the same drill three times.
 *
 * So a shared video alone is never enough. Two things are redundant only when
 * one name contains the other (the long-form and short-form entries of a
 * single drill, "High Tee Drill — Hitting Up in the Zone" and "High Tee"), or
 * when the names are the same once punctuation is stripped.
 */
export function isRedundant(a: DrillRecord, b: DrillRecord): boolean {
  const na = norm(a.drill_name)
  const nb = norm(b.drill_name)
  if (!na || !nb) return false
  if (na === nb) return true

  // Name containment only counts as duplication when they are also the same
  // piece of film. "Tee Work" is contained in "Tee Work — Ball Out In Front",
  // and those ARE the same drill; "Knee Drill" is contained in "Kneel-Down
  // (Wrist Snap) Drill" only by accident of wording, and those are not.
  const contained = na.includes(nb) || nb.includes(na)
  if (!contained) return false
  if (a.youtube_video_id && a.youtube_video_id === b.youtube_video_id) return true

  // Same name by containment, different video: treat as distinct. Two drills
  // filmed separately are two drills.
  return false
}

// ---------------------------------------------------------------------------
// Proposing a shape
// ---------------------------------------------------------------------------

export interface ScheduleItem {
  drill: DrillRecord
  minutes: number
  stage: number
  score: number
  /** Why this drill is in the plan, for the evaluator and for logs. */
  reason: string
}

export interface RejectedItem {
  drill: DrillRecord
  score: number
  reason: 'redundant' | 'no-duration' | 'over-budget'
  detail: string
}

export interface Schedule {
  items: ScheduleItem[]
  rejected: RejectedItem[]
  budget: Budget
  scheduledMinutes: number
  slack: number
  /** Drills whose duration came from the weakest evidence tier. */
  lowConfidenceDrillIds: string[]
}

export interface ScheduleInput {
  candidates: ScoredDrill[]
  budget: Budget
  /** Cap on drill blocks. Absent means the budget is the only limit. */
  maxItems?: number
  /**
   * Ids whose duration estimate is LOW confidence. Passed in rather than
   * derived, because confidence lives with the estimator and this module has
   * no business recomputing it. Purely observational — a LOW-confidence
   * duration never disqualifies a drill.
   */
  lowConfidenceIds?: Set<string>
}

/**
 * Choose the drills, in the order they should be run.
 *
 * Greedy in relevance order, which is the whole point: the strongest coaching
 * match goes in first and the clock is spent around it. This is deliberately
 * NOT a knapsack — packing the combination of durations closest to the budget
 * would routinely drop the best drill in favour of three weak short ones,
 * which is exactly the failure this is written to avoid.
 *
 * It keeps looking after the first drill that does not fit, so a 15-minute
 * drill cannot make the rest of the list unreachable purely by ordering.
 */
export function schedulePractice(input: ScheduleInput): Schedule {
  const { candidates, budget } = input
  const maxItems = input.maxItems ?? Infinity
  const low = input.lowConfidenceIds ?? new Set<string>()

  const items: ScheduleItem[] = []
  const rejected: RejectedItem[] = []
  let spent = 0

  for (const c of candidates) {
    if (items.length >= maxItems) break

    const minutes = c.drill.est_duration_minutes
    // A drill with no duration cannot be scheduled against a clock. It is not
    // dropped from the coach's world — it simply cannot be placed by time, and
    // saying so is better than assuming a number.
    if (typeof minutes !== 'number' || minutes <= 0) {
      rejected.push({
        drill: c.drill, score: c.reason.score, reason: 'no-duration',
        detail: 'est_duration_minutes missing or non-positive',
      })
      continue
    }

    const clash = items.find(i => isRedundant(i.drill, c.drill))
    if (clash) {
      rejected.push({
        drill: c.drill, score: c.reason.score, reason: 'redundant',
        detail: `same activity as "${clash.drill.drill_name}"`,
      })
      continue
    }

    if (spent + minutes > budget.drillBudget) {
      rejected.push({
        drill: c.drill, score: c.reason.score, reason: 'over-budget',
        detail: `${minutes} min would take the plan to ${spent + minutes} of ${budget.drillBudget}`,
      })
      continue
    }

    items.push({
      drill: c.drill,
      minutes,
      stage: stageOf(c.drill as any),
      score: c.reason.score,
      reason: c.reason.primary + (c.reason.curated ? ' (curated)' : ''),
    })
    spent += minutes
  }

  // Order for coaching, not for score.
  //
  // Selection is by relevance; sequence is by progression, so a practice moves
  // from the simpler version of a skill toward the game-speed one rather than
  // running the hardest drill first because it happened to rank highest.
  // Score breaks ties inside a stage, and the drill id breaks ties after that
  // so the same inputs always produce the same plan.
  const ordered = items.slice().sort((a, b) =>
    a.stage - b.stage ||
    b.score - a.score ||
    String(a.drill.id).localeCompare(String(b.drill.id))
  )

  return {
    items: ordered,
    rejected,
    budget,
    scheduledMinutes: spent,
    slack: budget.drillBudget - spent,
    lowConfidenceDrillIds: ordered.filter(i => low.has(String(i.drill.id))).map(i => String(i.drill.id)),
  }
}

// ---------------------------------------------------------------------------
// Enforcing the budget on what the model returned
// ---------------------------------------------------------------------------

export interface FitResult<T> {
  blocks: T[]
  total: number
  /** What was done to make the arithmetic true, for logging. */
  adjustments: string[]
}

/**
 * Make the model's block list add up to no more than the requested minutes.
 *
 * The generator is asked for durations that "add to about N minutes" and
 * mostly complies. Mostly is not a contract. This is the thing that makes
 * "no plan exceeds its requested duration" a fact rather than an instruction.
 *
 * Two passes, in order of least damage:
 *
 *   1. TRIM PROPORTIONALLY. A plan that is 8% long becomes 8% shorter across
 *      its blocks. Every block keeps its shape and its place, which is what a
 *      coach would do — run each thing slightly shorter — and no block is
 *      trimmed below a floor where it stops being runnable.
 *
 *   2. DROP FROM THE END. If proportional trimming cannot get there without
 *      shredding blocks below the floor, blocks come off the back. The back is
 *      chosen because the plan is already progression-ordered and the front
 *      carries the teaching; a plan that loses its competitive finish is worse
 *      than one that loses its opening drill, but not by as much as a plan
 *      that keeps six blocks of three minutes each.
 *
 * Under-length plans are left alone. See ACCEPTABLE_SLACK_MINUTES.
 */
export function fitBlocks<T extends { minutes?: number; type?: string; title?: string }>(
  blocks: T[],
  requestedMinutes: number,
  opts: { minBlockMinutes?: number } = {}
): FitResult<T> {
  const floor = opts.minBlockMinutes ?? 3
  const adjustments: string[] = []

  const sane = blocks.map(b => ({
    ...b,
    minutes: Math.max(0, Math.round(Number(b.minutes) || 0)),
  })) as T[]

  const total = (arr: T[]) => arr.reduce((s, b) => s + (Number(b.minutes) || 0), 0)
  let current = total(sane)
  if (current <= requestedMinutes) {
    return { blocks: sane, total: current, adjustments }
  }

  adjustments.push(`model returned ${current} min for a ${requestedMinutes} min request`)

  // Pass 1 — proportional trim.
  const ratio = requestedMinutes / current
  let work = sane.map(b => ({
    ...b,
    minutes: Math.max(floor, Math.floor((Number(b.minutes) || 0) * ratio)),
  })) as T[]
  current = total(work)

  // Rounding down can leave a minute or two on the table; give it back to the
  // longest blocks so the plan uses the time it is allowed to use.
  let spare = requestedMinutes - current
  if (spare > 0) {
    const order = work
      .map((b, idx) => ({ idx, m: Number(b.minutes) || 0 }))
      .sort((a, b) => b.m - a.m)
    for (const { idx } of order) {
      if (spare <= 0) break
      ;(work[idx] as any).minutes = (Number(work[idx].minutes) || 0) + 1
      spare--
    }
    current = total(work)
  }

  if (current <= requestedMinutes) {
    adjustments.push(`trimmed proportionally to ${current} min`)
    return { blocks: work, total: current, adjustments }
  }

  // Pass 2 — the floor stopped the trim from reaching the budget, so there are
  // more blocks here than the clock supports. Drop from the back.
  while (work.length > 1 && total(work) > requestedMinutes) {
    const dropped = work[work.length - 1]
    work = work.slice(0, -1)
    adjustments.push(`dropped trailing block "${dropped.title ?? '(untitled)'}" (${dropped.minutes} min)`)
  }

  current = total(work)
  adjustments.push(`final ${current} min`)
  return { blocks: work, total: current, adjustments }
}

// ---------------------------------------------------------------------------
// Telling the model what it has to work with
// ---------------------------------------------------------------------------

/**
 * The scheduling guidance handed to the generator.
 *
 * A recommendation, phrased as one. The model still decides the practice — it
 * knows things the scheduler does not, like that a coach said "we have a game
 * Saturday" — and fitBlocks() catches the arithmetic afterwards either way.
 * Instructing it with numbers it can actually hit produces better plans than
 * silently trimming a plan built against no budget at all.
 */
export function describeSchedule(s: Schedule): string {
  const b = s.budget
  const lines: string[] = []

  lines.push(
    `TIME BUDGET — this is a ${b.requested}-minute practice and it may not run over.\n` +
    `About ${b.nonDrill} min goes to warm-up, game and cool-down blocks, and about ` +
    `${b.transitions} min is lost moving between blocks. That leaves roughly ` +
    `${b.drillBudget} min of actual drill time. Finishing a few minutes short is fine; ` +
    `going over is not.`
  )

  if (s.items.length > 0) {
    lines.push(
      `\nTHESE DRILLS FIT THE TIME AND THE PROBLEM, in a sensible order ` +
      `(${s.scheduledMinutes} of ${b.drillBudget} min):\n` +
      s.items.map((i, n) =>
        `${n + 1}. "${i.drill.drill_name}" — ${i.minutes} min, ${i.drill.skill_category}, stage ${i.stage}`
      ).join('\n') +
      `\nBuild the drill blocks from these unless you have a specific reason not to. ` +
      `The minutes are estimates of how long each drill takes to run once; use them ` +
      `as block lengths unless the coach's situation says otherwise.`
    )
  }

  return lines.join('\n')
}
