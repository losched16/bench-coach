// Choosing library drills for a skill and phase. Pure: takes the schedulable
// pool, returns rows. The curated library stays the primary source of baseball
// drills; built-in exercises only fill gaps and are reported when they do.

import type { DrillRecord } from '../drills'
import { ageEligible, environmentEligible, spaceEligible } from '../drillEligibility'
import { scoreDrillRelevance } from '../analysis'
import { hasVideo } from '../drillVideo'
import { stageOf } from '../progression'
import { SKILLS } from './skills'
import type { DrillRow, ProgramBrief, SkillKey } from './types'

type PhaseKey = 'foundation' | 'controlled' | 'reactive' | 'game_speed' | 'evaluation'

// Gear any baseball player has. Anything else must be on the coach's list.
const CORE_GEAR = /ball|glove|bat\b|helmet|none|no equipment|^$/i
// Things a family can stand in for with household items; flagged, not assumed.
const SUBSTITUTABLE = /cone|marker|spot|tape|chalk|line|towel|bucket|bag/i

export interface EquipmentFit { ok: boolean; substitutions: string[] }

export function equipmentFit(needs: string[] | null | undefined, have: string[]): EquipmentFit {
  const list = (needs || []).map(n => String(n).trim()).filter(Boolean)
  const got = have.map(h => h.toLowerCase())
  const subs: string[] = []
  for (const n of list) {
    const l = n.toLowerCase()
    if (CORE_GEAR.test(l)) continue
    if (got.some(g => g.includes(l) || l.includes(g))) continue
    if (l.includes('cage') && got.some(g => g.includes('cage'))) continue
    if (SUBSTITUTABLE.test(l)) { subs.push(n); continue }
    return { ok: false, substitutions: [] }
  }
  return { ok: true, substitutions: subs }
}

export interface Candidate { drill: DrillRecord; score: number; stage: number; substitutions: string[] }

/**
 * Eligible, ranked drills for one skill. Deterministic: ties break on id.
 *
 * Category first: a speed drill that merely mentions "first step" is not an
 * outfield-tracking drill. Text relevance alone is only a FALLBACK, used when
 * the library has nothing in the skill's own category.
 */
export function candidatesFor(skill: SkillKey, pool: DrillRecord[], brief: ProgramBrief): Candidate[] {
  const def = SKILLS[skill]
  const indoorOnly = brief.indoorAccess === true && brief.outdoorAccess === false
  const build = (useCategory: boolean): Candidate[] => {
    const out: Candidate[] = []
    for (const d of pool) {
      const cat = String(d.skill_category || d.primary_skill || '')
      const categoryHit = def.categoryPattern.test(cat)
      const rel = scoreDrillRelevance(def.drillQuery, d as any)
      if (useCategory ? !categoryHit : (categoryHit || rel < 10)) continue
      if (!ageEligible(d, brief.age)) continue
      if (indoorOnly && !environmentEligible(d, 'indoor')) continue
      if (!spaceEligible(d, null)) continue
      const fit = equipmentFit(d.equipment_needed, brief.equipment)
      if (!fit.ok) continue
      // A partner is a person standing next to the player: a parent. Allowed
      // for supervised sessions (selection is only used for those).
      // A small nudge toward drills a coach can also watch. Never enough to
      // outrank a clearly better-matched drill.
      const score = rel + (categoryHit ? 8 : 0) + (d.created_by_coach_id ? 2 : 0) + (hasVideo(d as any) ? 3 : 0)
      out.push({ drill: d, score, stage: stageOf(d as any), substitutions: fit.substitutions })
    }
    return out
  }
  const primary = build(true)
  const chosen = primary.length ? primary : build(false)
  return chosen.sort((a, b) => (b.score - a.score) || String(a.drill.id).localeCompare(String(b.drill.id)))
}

const PHASE_STAGE: Record<PhaseKey, number> = { foundation: 1, controlled: 1.5, reactive: 2, game_speed: 3, evaluation: 2 }

/**
 * Candidates ordered for a phase: closest progression stage first, then score.
 * The first element is the phase's ANCHOR drill; the same anchor is reused by
 * every session of the phase, which is what makes a program a progression
 * rather than a random sample.
 */
export function orderForPhase(cands: Candidate[], phase: PhaseKey): Candidate[] {
  const want = PHASE_STAGE[phase]
  return [...cands].sort((a, b) => {
    const da = Math.abs(a.stage - want), db = Math.abs(b.stage - want)
    if (da !== db) return da - db
    if (b.score !== a.score) return b.score - a.score
    return String(a.drill.id).localeCompare(String(b.drill.id))
  })
}

function sentences(s: string | null | undefined, max: number): string[] {
  return String(s || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 3).slice(0, max)
}

export function rowFromDrill(c: Candidate, skill: SkillKey, minutes: number, phase: PhaseKey): DrillRow {
  const d = c.drill
  const instr = sentences(d.description, 4)
  const coaching = sentences(d.ai_coaching_notes, 3)
  const cues = (d.mechanic_focus || []).slice(0, 2).map(String)
  const reps = d.reps_guidance ? String(d.reps_guidance).slice(0, 60) : null
  const sets = reps ? null : 3
  if (c.substitutions.length) instr.push(`No ${c.substitutions.join(', ')}? Use shoes, water bottles or a line in the dirt.`)
  if (d.safety_notes) instr.push(`Safety: ${String(d.safety_notes).slice(0, 160)}`)
  return {
    drillId: d.id, exerciseKey: null, name: d.drill_name, skill, minutes,
    sets, reps: reps ?? '8–10 quality reps per set',
    rest: null,
    intensity: phase === 'game_speed' ? 'game_speed' : phase === 'reactive' ? 'fast' : phase === 'foundation' ? 'easy' : 'moderate',
    instructions: [...instr, ...coaching].slice(0, 8).map(s => s.slice(0, 300)),
    cues: cues.map(s => s.slice(0, 120)),
    success: (d.success_markers || []).slice(0, 3).map(s => String(s).slice(0, 200)),
    modification: (d.regression_notes || '').slice(0, 300) || null,
    equipment: (d.equipment_needed || []).map(String),
    hasVideo: hasVideo(d as any),
  }
}
