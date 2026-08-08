// Turning a set of drills into a progression.
//
// A plan that lists four drills side by side is not a plan, it is a menu. A kid
// working "Front Toss" on day one because it was card number three is doing the
// hard version of a movement he cannot yet make slowly, and the parent has no
// way to know that — the cards look identical.
//
// A real progression has a shape, and it is the same shape in every sport:
//
//   1. Get the feel     — slow, static, no ball or no pressure. One thing to
//                         think about. You are teaching a position, not a skill.
//   2. Make it stick    — same movement with the ball, at controlled speed,
//                         enough reps that it stops needing thought.
//   3. Take it live     — game speed, reacting, under some pressure. This is
//                         where it either transfers or it doesn't.
//
// and between each one a GATE: an observable thing that says he is ready. Not
// a date. The countdown came out of this product on purpose — a kid is ready
// when he is ready, and the person watching him every day is the one who knows.
//
// All of this was already in the library. drill_resources.progression_level was
// curated by hand in migrations 004 and 008, success_markers holds the gates,
// and reps_guidance holds the dose. /api/prescribe already sorts by it. The
// only thing missing was anything that read it.
//
// Derived rather than authored, deliberately: it costs no model call, it is the
// same every time, it works on plans issued a year ago with no backfill, and
// the judgement in it came from a human curating the library rather than a
// model improvising a curriculum on the spot.

export interface ProgressionDrill {
  id: string
  drill_name: string
  description?: string | null
  progression_level?: number | null
  difficulty_level?: string | null
  reps_guidance?: string | null
  frequency_guidance?: string | null
  success_markers?: string[] | null
  [key: string]: any
}

export interface PlanStep {
  // 1-based, and contiguous — steps are renumbered after empty ones are
  // dropped, so a plan never shows "Step 1, Step 3".
  n: number
  title: string
  // Why this step exists, in the parent's language.
  why: string
  drillIds: string[]
  // What to see before moving up. Empty when the library has no marker on any
  // drill in the step, which the UI has to handle honestly rather than
  // inventing one.
  moveOnWhen: string[]
}

const STAGES: Array<{ level: number; title: string; why: string }> = [
  {
    level: 1,
    title: 'Get the feel',
    why: 'Slow and simple, with one thing to think about. He is learning what the movement feels like — not trying to do it well yet.',
  },
  {
    level: 2,
    title: 'Make it stick',
    why: 'Same movement, more reps, closer to real speed. This is the part that takes the longest and the part most people skip.',
  },
  {
    level: 3,
    title: 'Take it to the game',
    why: 'Full speed, reacting rather than rehearsing. If it holds up here it is his; if it falls apart, go back a step — that is information, not failure.',
  },
]

const DIFFICULTY_TO_LEVEL: Record<string, number> = {
  beginner: 1,
  easy: 1,
  intermediate: 2,
  moderate: 2,
  advanced: 3,
  hard: 3,
}

/**
 * Which stage a drill belongs to.
 *
 * progression_level is the curated answer and wins. difficulty_level is the
 * fallback for library rows that predate the curation. Anything still unknown
 * lands in the middle — putting an unlabelled drill at step 1 would tell a
 * parent to start there, and putting it at step 3 would hide it behind two
 * gates it may not belong behind.
 */
export function stageOf(drill: ProgressionDrill): number {
  const p = drill.progression_level
  if (typeof p === 'number' && p >= 1) return Math.min(3, Math.round(p))
  const d = (drill.difficulty_level || '').toLowerCase()
  return DIFFICULTY_TO_LEVEL[d] ?? 2
}

/**
 * Build the staged plan from the prescribed drills.
 *
 * Order within a step is the order the drills arrived in — /api/prescribe
 * sorted them curated-first, and that order is a judgement we should not
 * re-litigate here.
 */
export function buildSteps(drills: ProgressionDrill[]): PlanStep[] {
  if (!drills || drills.length === 0) return []

  const steps = STAGES
    .map(stage => {
      const inStage = drills.filter(d => stageOf(d) === stage.level)
      return {
        title: stage.title,
        why: stage.why,
        drillIds: inStage.map(d => d.id),
        // Deduped: two drills in a step often share a marker, and telling a
        // parent to watch for the same thing twice reads like a mistake.
        moveOnWhen: Array.from(new Set(
          inStage.flatMap(d => d.success_markers || []).filter(Boolean)
        )),
      }
    })
    .filter(s => s.drillIds.length > 0)

  // The last step has nothing after it, so it has no gate — "move on when" on
  // the final step is a promise the plan cannot keep. What ends a plan is the
  // check-in, not a drill marker.
  if (steps.length > 0) steps[steps.length - 1].moveOnWhen = []

  return steps.map((s, i) => ({ n: i + 1, ...s }))
}

/**
 * The steps to show for a prescription.
 *
 * Stored steps win when they still match the drills on the plan — a coach who
 * has been told "step 2 is front toss" should not find it renumbered because
 * the library changed underneath them. When a drill has been swapped, the
 * stored steps no longer describe reality and are rebuilt.
 */
export function resolveSteps(
  stored: PlanStep[] | null | undefined,
  drills: ProgressionDrill[]
): PlanStep[] {
  const fresh = buildSteps(drills)
  if (!stored || stored.length === 0) return fresh

  const storedIds = new Set(stored.flatMap(s => s.drillIds || []))
  const liveIds = new Set(drills.map(d => d.id))
  const same =
    storedIds.size === liveIds.size &&
    Array.from(liveIds).every(id => storedIds.has(id))

  return same ? stored : fresh
}

/**
 * Clamped so a plan whose drills were swapped down to fewer steps cannot leave
 * a coach parked on a step that no longer exists.
 */
export function clampStep(step: number | null | undefined, steps: PlanStep[]): number {
  if (steps.length === 0) return 1
  const n = typeof step === 'number' && step >= 1 ? step : 1
  return Math.min(n, steps.length)
}

/**
 * One line for a check-in or a context block: where this plan actually is.
 */
export function describeProgress(steps: PlanStep[], current: number): string {
  if (steps.length === 0) return 'No drills attached.'
  const n = clampStep(current, steps)
  return `Step ${n} of ${steps.length} — ${steps[n - 1].title}`
}
