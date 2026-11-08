// Safety rules for youth programs.
//
// Two kinds of content live here and they are kept apart on purpose:
//
//   1. MLB Pitch Smart GAME rules (daily max, rest days). Copied from
//      https://www.mlb.com/pitch-smart/pitching-guidelines (checked
//      2026-11-08). They govern games. Pitch Smart publishes NO weekly limit,
//      NO practice limit and NO annual-break number on that page, so none is
//      invented here. Re-check the source before changing anything below.
//
//   2. BenchCoach program design for throwing READINESS: a gate that stays
//      closed until a coach opens it, and a ladder of easy steps. These are
//      starting points a coach adjusts, not limits and not medical advice.

import type { ProgramBrief, ProgramSession, ThrowingGate } from './types'
import { EXERCISE_BY_KEY } from './exercises'

export const PITCH_SMART_SOURCE = 'MLB Pitch Smart — https://www.mlb.com/pitch-smart/pitching-guidelines'

export const PITCH_SMART_DAILY_MAX: Array<{ minAge: number; maxAge: number; max: number }> = [
  { minAge: 7, maxAge: 8, max: 50 },
  { minAge: 9, maxAge: 10, max: 75 },
  { minAge: 11, maxAge: 12, max: 85 },
  { minAge: 13, maxAge: 14, max: 95 },
]

export function pitchSmartDailyMax(age: number | null): number | null {
  if (age == null) return null
  return PITCH_SMART_DAILY_MAX.find(r => age >= r.minAge && age <= r.maxAge)?.max ?? null
}

/** Days of rest Pitch Smart lists for a game outing, ages 9–10 and 7–8. */
export function pitchSmartRestDays(age: number, pitches: number): number | null {
  const max = pitchSmartDailyMax(age)
  if (max == null || pitches > max) return null
  if (pitches <= 20) return 0
  if (pitches <= 35) return 1
  if (pitches <= 50) return 2
  if (pitches <= 65) return 3
  return age <= 8 ? null : 4
}

/**
 * The throwing gate. A draft ALWAYS starts closed: the exact rest period and
 * any pain history are things the app cannot know, so the decision to start
 * throwing belongs to a person who has looked at the child.
 */
export function buildThrowingGate(brief: ProgramBrief): ThrowingGate | null {
  const wants = brief.skills.includes('pitching_readiness') || brief.skills.includes('throwing')
  if (!wants) return null
  const unknownRest = brief.throwing.status === 'resting' && !brief.throwing.restDetails
  return {
    cleared: false,
    checklist: [
      'The player reports no pain in the shoulder, elbow or forearm at rest, overhead, or while throwing easy.',
      'Range of motion is equal on both sides (overhead reach, behind-the-head, across-the-chest).',
      brief.throwing.painHistory === 'reported'
        ? 'A medical professional has evaluated the earlier pain and said throwing may resume. Do not start the ladder before that.'
        : 'No pain or injury history that has not been seen by a medical professional.',
      unknownRest
        ? 'You know how long the arm has rested and why. (The program was not told — record it here.)'
        : 'You know how long the arm has rested and why.',
      'You are present for every throwing session.',
    ],
    ladder: [
      { step: 1, name: 'Arm care only', description: 'Light arm-care circuit and legs-and-balance work. No throwing. Stay here until the checklist is complete.' },
      { step: 2, name: 'Easy short-distance catch', description: 'Relaxed catch at a comfortable short distance, no more than a few minutes, effort well below normal. Stop at any pain, stiffness or fatigue.' },
      { step: 3, name: 'Longer easy catch', description: 'Add distance slowly, keeping the effort easy and the mechanics clean. Move up only after two pain-free sessions in a row.' },
      { step: 4, name: 'Throws to a target', description: 'Accuracy throws at a comfortable effort. Still no velocity goal and no radar.' },
      { step: 5, name: 'Easy delivery work', description: 'Flat-ground delivery work at easy effort with a balance-and-sequence cue. Mound work only after the earlier steps have been pain-free for a sustained period and the coach has decided.' },
    ],
    note:
      'This is a readiness gate, not a pitch-count limit. BenchCoach does not set weekly or practice pitch limits. ' +
      'Game pitching must follow your league’s rules and MLB Pitch Smart (daily max and required rest). ' +
      'Any pain means stop, and a medical professional should evaluate it. No velocity increase is promised.',
  }
}

/** The step a session may use, given whether the gate is open. */
export function ladderStepFor(gate: ThrowingGate | null, weekIndex: number): number {
  if (!gate || !gate.cleared) return 1
  return Math.min(gate.ladder.length, 2 + Math.floor(weekIndex / 2))
}

// ── Independence ─────────────────────────────────────────────────────────────

const RANK = { independent: 0, parent: 1, coach: 2 } as const

/**
 * The supervision a session REALLY needs: the strictest of its exercises.
 * Library drills (no exerciseKey) are never independent — a curated drill may
 * involve a ball, a bat or a partner, and nothing here can prove otherwise.
 */
export function requiredSupervision(s: Pick<ProgramSession, 'blocks' | 'kind'>): 'independent' | 'parent' | 'coach' {
  let worst: 'independent' | 'parent' | 'coach' = 'independent'
  for (const b of s.blocks) {
    for (const d of b.drills) {
      let need: 'independent' | 'parent' | 'coach' = 'parent'
      if (d.exerciseKey) need = EXERCISE_BY_KEY[d.exerciseKey]?.supervision ?? 'parent'
      if (RANK[need] > RANK[worst]) worst = need
    }
    if (b.kind === 'throwing' || b.kind === 'assessment') {
      if (RANK.parent > RANK[worst]) worst = 'parent'
    }
  }
  if (s.kind === 'throwing' || s.kind === 'assessment' || s.kind === 'strength') {
    if (RANK.parent > RANK[worst]) worst = 'parent'
  }
  return worst
}

const CONTRADICTS_INDEPENDENT = /\b(max(?:imal|imum)? (?:effort|lift|weight)|one[- ]rep max|1rm|throw(?:s|ing)? (?:at|to) a? ?(?:wall|fence)|bullpen|mound|live pitch)\b/i

/** Violations of the independent-work rule. Empty means the session is safe as labelled. */
export function independenceViolations(s: ProgramSession): string[] {
  if (s.supervision !== 'independent') return []
  const out: string[] = []
  const need = requiredSupervision(s)
  if (need !== 'independent') out.push(`${s.key} is labelled independent but contains work that needs ${need} supervision`)
  for (const b of s.blocks) for (const d of b.drills) {
    if (d.intensity === 'game_speed') out.push(`${s.key}: "${d.name}" is game-speed work and cannot be independent`)
    const text = [d.name, ...d.instructions].join(' ')
    if (CONTRADICTS_INDEPENDENT.test(text)) out.push(`${s.key}: "${d.name}" mentions work that is not independent-safe`)
  }
  return out
}
