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
//
// WHAT CHANGED (056)
//
// The headcount and the coach count are now inputs, and they buy exactly one
// new thing: a note saying which of the already-chosen drills could run side by
// side. They do NOT change the budget arithmetic, because est_duration_minutes
// is still a base estimate and rescaling it by roster size would be inventing
// the multiplier this header just said we do not have. The stations note keeps
// the same clock and changes how many kids are moving inside it.

import { DrillRecord } from './drills'
import { ScoredDrill } from './drillRetrieval'
import { stageOf } from './progression'
import { planStationGroup, StationGroup, describeStationGroup, MIN_STATION_GROUP } from './stationPlanner'
import {
  drillPriorities, normalizePriority, defaultLabel, UNDER_COVERED_SHARE, MIN_ABSOLUTE_MINUTES,
} from './priorityMap'

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
 * "Tee Work" and "Low Tee" both come off q7CPS0RYDPM, and a coach running them
 * in sequence is running a progression, not the same drill twice.
 *
 * So a shared video alone is never enough. Two things are redundant only when
 * one name contains the other (the long-form and short-form entries of a
 * single drill, "High Tee Drill — Hitting Up in the Zone" and "High Tee"), or
 * when the names are the same once punctuation is stripped.
 *
 * FAMILIES (migration 056)
 *
 * Names are a proxy for sameness and a bad one in both directions. A family is
 * the direct answer, but only half of it: sharing a family is emphatically NOT
 * redundancy, because the whole reason families exist is to hold a progression
 * together. "Protect the Castle" and "Protect the Castle + Throw" are one
 * family and two different practices' worth of work, and suppressing the second
 * because of the first would delete exactly the thing this migration was added
 * to represent.
 *
 * What a family DOES catch is two rows sitting at the SAME point in it — two
 * `base` entries of one activity, differently worded, which the name check
 * misses whenever the wordings do not overlap. That, and only that, is the new
 * rule: same family AND same variation_type, both known.
 */
export function isRedundant(a: DrillRecord, b: DrillRecord): boolean {
  // Same family, same rung of it. Checked before names because it is the more
  // reliable signal where it exists — and it is null for the whole library
  // until calibration data lands, at which point this quietly starts working.
  if (
    a.activity_family_id && b.activity_family_id &&
    a.activity_family_id === b.activity_family_id &&
    a.variation_type && b.variation_type &&
    a.variation_type === b.variation_type
  ) {
    return true
  }

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
  reason: 'redundant' | 'no-duration' | 'over-budget' | 'balance'
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
  /**
   * Which of the scheduled drills could run in parallel instead of in sequence,
   * or null when the people present cannot support stations. A SUGGESTION: it
   * never removes an item from `items` and never changes `scheduledMinutes`.
   */
  stations: StationGroup | null
  /** Drill minutes the proposal gives each selected priority, when given any. */
  priorityMinutes: Record<string, number> | null
}

export interface ScheduleInput {
  candidates: ScoredDrill[]
  budget: Budget
  /** Cap on drill blocks. Absent means the budget is the only limit. */
  maxItems?: number
  /**
   * The focus areas the coach selected, as they ticked them. When given, the
   * proposal reserves a minimum meaningful share of the drill budget for each
   * of them BEFORE filling the rest by relevance — see the reservation pass in
   * schedulePractice(). Absent means the proposal is by relevance alone, which
   * is how single-focus practices still work.
   */
  priorities?: string[]
  /**
   * Extra candidates per priority, for a focus area the combined retrieval
   * starved. Only consulted while reserving that priority's share.
   */
  candidatesByPriority?: Record<string, ScoredDrill[]>
  /**
   * How many kids. Used only to size stations — never to scale a duration.
   * Absent means unknown, and unknown means no stations are proposed, because
   * "three groups of four" said to a coach with seven players is worse than
   * saying nothing.
   */
  expectedPlayers?: number | null
  /** How many adults. Absent is unknown, which is not a constraint. */
  coachCount?: number | null
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

  // Pass 0 — every selected priority gets its minimum share first.
  //
  // A combined query ranks the whole pool by relevance to one sentence, so a
  // practice with three focus areas can fill its clock with the two whose
  // drills happen to score higher and leave the third with nothing. This is
  // the layer that let a coach's "Hitting" become one ten-minute block. So
  // before relevance decides anything, each priority is given its best drills
  // until it holds the minimum meaningful share, in the order the coach
  // listed them. Relevance still orders everything after that.
  const priorities = (input.priorities || []).map(normalizePriority).filter(Boolean)
  const reservedIds = new Set<string>()
  const held: Record<string, number> = Object.fromEntries(priorities.map(p => [p, 0]))
  const creditHeld = (d: DrillRecord, minutes: number) => {
    for (const p of drillPriorities(d, priorities)) held[p] += minutes
  }
  if (priorities.length > 1) {
    const fair = budget.drillBudget / priorities.length
    // Never above the fair share itself: a 15-minute drill budget split two
    // ways cannot owe each priority eight minutes.
    const minimum = Math.min(Math.round(fair), Math.max(MIN_ABSOLUTE_MINUTES, Math.round(fair * UNDER_COVERED_SHARE)))
    const pools: Record<string, ScoredDrill[]> = Object.fromEntries(priorities.map(p => [p, [
      ...candidates.filter(c => drillPriorities(c.drill, [p]).length),
      ...(input.candidatesByPriority?.[p] || []),
    ]]))
    // The best-ranked eligible drill for the priority; with a cap, the
    // best-ranked one that does not blow past the share it is filling, so a
    // 15-minute drill does not eat the minutes two other priorities needed.
    const takeFor = (p: string, cap?: number): boolean => {
      const eligible = (c: ScoredDrill) => {
        const minutes = c.drill.est_duration_minutes
        return !reservedIds.has(String(c.drill.id)) &&
          typeof minutes === 'number' && minutes > 0 &&
          !items.find(i => isRedundant(i.drill, c.drill)) &&
          spent + minutes <= budget.drillBudget
      }
      const pick = (cap != null && pools[p].find(c => eligible(c) && (c.drill.est_duration_minutes as number) <= cap))
        || pools[p].find(eligible)
      if (pick) {
        const c = pick
        const minutes = c.drill.est_duration_minutes as number
        items.push({
          drill: c.drill, minutes, stage: stageOf(c.drill as any), score: c.reason.score,
          reason: `${c.reason.primary}${c.reason.curated ? ' (curated)' : ''} · reserved for ${p}`,
        })
        reservedIds.add(String(c.drill.id))
        spent += minutes
        creditHeld(c.drill, minutes)
        return true
      }
      return false
    }
    // 0a. Each priority to its minimum, in the coach's order.
    for (const p of priorities) {
      while (held[p] < minimum && items.length < maxItems && takeFor(p, Math.round(fair) - held[p] + 4)) { /* keep taking */ }
    }
    // 0b. Then round-robin, lowest-covered first, up to a fair share each.
    //     Co-primary means roughly even until relevance takes over — never
    //     an exact split, and never past what the budget holds.
    const exhausted = new Set<string>()
    while (items.length < maxItems) {
      const open = priorities.filter(p => held[p] < fair && !exhausted.has(p))
      if (open.length === 0) break
      const p = open.sort((a, b) => held[a] - held[b])[0]
      if (!takeFor(p, Math.round(fair) - held[p] + 4)) exhausted.add(p)
    }
  }

  const minHeld = () => priorities.length > 1 ? Math.min(...priorities.map(p => held[p])) : 0

  for (const c of candidates) {
    if (items.length >= maxItems) break
    if (reservedIds.has(String(c.drill.id))) continue

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

    // Relevance fills the rest, but not to the point where one selected
    // priority holds more than twice what another does. The remaining minutes
    // go unspent instead — a practice may finish short; it may not quietly
    // become a one-skill practice the coach did not ask for.
    const ps = drillPriorities(c.drill, priorities)
    if (priorities.length > 1 && ps.length && ps.some(p => held[p] + minutes > 2 * Math.max(MIN_ABSOLUTE_MINUTES, minHeld()))) {
      rejected.push({
        drill: c.drill, score: c.reason.score, reason: 'balance',
        detail: `${ps.join('/')} already holds ${ps.map(p => held[p]).join('/')} min against ${minHeld()} for the least-covered priority`,
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
    creditHeld(c.drill, minutes)
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
    stations: proposeStations(ordered, input.expectedPlayers, input.coachCount),
    priorityMinutes: priorities.length
      ? Object.fromEntries(priorities.map(p => [
          p, ordered.filter(i => drillPriorities(i.drill, [p]).length).reduce((n, i) => n + i.minutes, 0),
        ]))
      : null,
  }
}

/**
 * Which of the chosen drills could run at the same time.
 *
 * Built from drills ALREADY in the plan, never from fresh candidates, for two
 * reasons. Relevance was decided upstream and a station note is not a licence
 * to smuggle a worse drill back in. And the time window is then real: the
 * minutes are ones the plan had already committed to these drills, so the
 * suggestion cannot push the practice over its budget however it is used.
 *
 * Two passes because the window depends on which drills are chosen and the
 * choice depends on the coach budget, which lives in planStationGroup. Passing
 * one, reading the answer, and re-sizing the window to exactly the chosen
 * drills is simpler and more honest than predicting its choice here.
 */
function proposeStations(
  items: ScheduleItem[],
  expectedPlayers: number | null | undefined,
  coachCount: number | null | undefined
): StationGroup | null {
  if (expectedPlayers == null || expectedPlayers < MIN_STATION_GROUP * 2) return null

  // Only drills at the same point in the practice. Running a warm-up and a
  // game-speed drill as parallel stations is not a rotation, it is two
  // different practices happening at once.
  const byStage = new Map<number, ScheduleItem[]>()
  for (const i of items) {
    if (i.drill.station_friendly === false) continue
    if (!byStage.has(i.stage)) byStage.set(i.stage, [])
    byStage.get(i.stage)!.push(i)
  }

  // The fullest stage, ties broken by the earlier one so the answer is stable.
  const stages = Array.from(byStage.entries())
    .filter(([, v]) => v.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
  if (stages.length === 0) return null

  const pool = stages[0][1]
  const asScored = (list: ScheduleItem[]): ScoredDrill[] =>
    list.map(i => ({ drill: i.drill, reason: { score: i.score } })) as ScoredDrill[]

  const firstPass = planStationGroup({
    candidates: asScored(pool),
    expectedPlayers,
    coachCount,
    availableMinutes: pool.reduce((n, i) => n + i.minutes, 0),
  })
  if (!firstPass) return null

  // Re-size the window to the drills it actually picked.
  const chosenIds = new Set(firstPass.stations.map(s => String(s.drill.id)))
  const chosen = pool.filter(i => chosenIds.has(String(i.drill.id)))
  return planStationGroup({
    candidates: asScored(chosen),
    expectedPlayers,
    coachCount,
    availableMinutes: chosen.reduce((n, i) => n + i.minutes, 0),
  })
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

  // What each selected focus area gets out of the shortlist, so the model can
  // see the balance it is being asked to keep rather than infer it.
  if (s.priorityMinutes && Object.keys(s.priorityMinutes).length > 1) {
    const rows = Object.entries(s.priorityMinutes)
      .map(([p, m]) => `${defaultLabel(p)}: ${m} min`)
      .join(', ')
    lines.push(
      `\nEVERY SELECTED FOCUS AREA MUST GET REAL REPS. Drill minutes above by focus area — ${rows}. ` +
      `A selected area that ends up with one short block while another gets three is a plan ` +
      `the coach did not ask for. A warm-up that mentions swings is not hitting work; a fungo ` +
      `drill is fielding, not hitting. If the people and the drills allow it, a station ` +
      `rotation with one station per focus area is often the best way to give all of them ` +
      `real time inside one clock.`
    )
  }

  // Said as an option rather than an instruction. The model knows things this
  // module does not — that the coach asked for a scrimmage, that two of these
  // want the same net — and a station rotation the coach cannot actually set up
  // is worse than three ordinary blocks.
  if (s.stations) {
    lines.push(
      `\nTHESE COULD RUN AS STATIONS INSTEAD OF ONE AFTER THE OTHER:\n` +
      describeStationGroup(s.stations) +
      `\nSame ${s.stations.totalMinutes} minutes of practice either way — the ` +
      `difference is that every kid is doing something for all of it instead of ` +
      `waiting their turn in a line of ${s.stations.stations.reduce((n, x) => n + x.groupSize, 0)}. ` +
      `If you use this, write it as ONE block with the rotation spelled out ` +
      `(groups, minutes per rotation, who goes where), not as three blocks — ` +
      `three blocks would triple the time on the clock and the practice would not fit.`
    )
  }

  return lines.join('\n')
}
