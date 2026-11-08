// Reading a program's results honestly, and proposing changes the coach can
// approve. Pure; the routes do the I/O.
//
// Rules this file keeps:
//   * A single session never changes a program. The one exception is pain,
//     which pauses the affected work immediately because the cost of being
//     wrong is a child's arm.
//   * Fewer than three readings is a direction, not a trend, and says so.
//   * A challenge scored out of fewer than ten attempts is low confidence.
//   * Proposals are PROPOSALS. Nothing here edits a completed session.

import { computeTrend, groupIntoSessions, formatValue, type MetricReading } from '../metrics'
import { SKILLS } from './skills'
import { EXERCISE_BY_KEY, toDrillRow } from './exercises'
import type { ProgramSession, SkillKey } from './types'

export interface MetricDef { slug: string; label: string; unit: string | null; direction: 'higher' | 'lower'; shape: 'measurement' | 'challenge' }
export interface ProgramReading extends MetricReading {
  slug: string
  checkpoint: 'baseline' | 'midpoint' | 'final' | 'session' | null
  conditions: string | null
}

export interface AssessmentLine {
  slug: string
  label: string
  baseline: string | null
  latest: string | null
  /** Plain words. Never 'improved' on fewer than two readings. */
  direction: 'improved' | 'worse' | 'about_the_same' | 'not_enough_data'
  readings: number
  attempts: number | null
  confidence: 'low' | 'moderate'
  conditions: string | null
  note: string
}

export function summariseAssessment(def: MetricDef, readings: ProgramReading[]): AssessmentLine {
  const rs = readings.filter(r => r.slug === def.slug)
  const sessions = groupIntoSessions(rs, def.direction)
  const base = rs.find(r => r.checkpoint === 'baseline') ? sessions.find(s => rs.some(r => r.checkpoint === 'baseline' && r.measured_on === s.date)) ?? sessions[0] : sessions[0]
  const latest = sessions[sessions.length - 1]
  const attempts = sessions.reduce((a, s) => a + (s.attempts || 0), 0) || null
  const fmt = (n: number) => formatValue(n, def)
  const conditions = rs.map(r => r.conditions).filter(Boolean).slice(-1)[0] ?? null
  const lowN = def.shape === 'challenge' && !!latest && (latest.attempts ?? 0) < 10
  if (!base || sessions.length < 2) {
    return { slug: def.slug, label: def.label, baseline: base ? fmt(def.shape === 'challenge' ? base.average : base.best) : null, latest: null,
      direction: 'not_enough_data', readings: rs.length, attempts, confidence: 'low', conditions,
      note: base ? 'Only the baseline is recorded. A second reading under the same conditions is needed to compare.' : 'Nothing recorded yet.' }
  }
  const pick = (s: typeof base) => (def.shape === 'challenge' ? s.average : s.best)
  const change = pick(latest) - pick(base)
  const improvement = def.direction === 'lower' ? -change : change
  const pct = pick(base) ? (improvement / Math.abs(pick(base))) * 100 : 0
  const direction: AssessmentLine['direction'] = Math.abs(pct) < 3 ? 'about_the_same' : improvement > 0 ? 'improved' : 'worse'
  const trend = computeTrend(sessions, def)
  const confidence: 'low' | 'moderate' = sessions.length >= 3 && !lowN ? 'moderate' : 'low'
  return {
    slug: def.slug, label: def.label, baseline: fmt(pick(base)), latest: fmt(pick(latest)), direction, readings: sessions.length, attempts,
    confidence, conditions,
    note: sessions.length < 3
      ? `Two readings show direction only, not a trend. ${lowN ? 'The latest attempt count is small.' : ''}`.trim()
      : trend.summary,
  }
}

// ── adaptive proposals ───────────────────────────────────────────────────────

export interface CompletionIn {
  sessionKey: string
  date: string
  skills: SkillKey[]
  /** Coach's read of the session for each skill. */
  ratings: Partial<Record<SkillKey, 'easy' | 'right' | 'hard'>>
  painReported: boolean
}

export type Change =
  | { op: 'add_drill'; skill: SkillKey; exerciseKey: string; minutes: number }
  | { op: 'ease'; skill: SkillKey }
  | { op: 'progress'; skill: SkillKey }
  | { op: 'pause_throwing' }

export interface Proposal {
  skill: SkillKey | null
  action: 'advance' | 'maintain' | 'regress' | 'pause' | 'reassess' | 'modify'
  summary: string
  evidence: string[]
  changes: Change[]
  /** How many sessions or readings stand behind it. */
  support: number
}

const MIN_SESSIONS = 3

export function proposeAdjustments(input: {
  completions: CompletionIn[]
  lines: AssessmentLine[]
  skills: SkillKey[]
}): Proposal[] {
  const out: Proposal[] = []
  const done = [...input.completions].sort((a, b) => a.date.localeCompare(b.date))

  const pain = done.filter(c => c.painReported)
  if (pain.length) {
    const last = pain[pain.length - 1]
    out.push({
      skill: 'pitching_readiness', action: 'pause',
      summary: 'Pain was reported. Pause throwing work and have the arm looked at before continuing.',
      evidence: [`Pain noted in ${last.sessionKey} on ${last.date}.`],
      changes: [{ op: 'pause_throwing' }], support: pain.length,
    })
  }

  for (const skill of input.skills) {
    const rated = done.filter(c => c.skills.includes(skill) && c.ratings[skill]).map(c => c.ratings[skill]!)
    if (rated.length >= MIN_SESSIONS) {
      const tail = rated.slice(-MIN_SESSIONS)
      if (tail.every(r => r === 'easy')) {
        out.push({ skill, action: 'advance', summary: `${SKILLS[skill].label}: the last ${MIN_SESSIONS} sessions were rated easy. Consider stepping up the difficulty.`,
          evidence: [`Last ${MIN_SESSIONS} sessions rated easy.`], changes: [{ op: 'progress', skill }], support: MIN_SESSIONS })
      } else if (rated.slice(-2).every(r => r === 'hard')) {
        out.push({ skill, action: 'regress', summary: `${SKILLS[skill].label}: the last two sessions were hard. Consider an easier variation before moving on.`,
          evidence: ['Last 2 sessions rated hard.'], changes: [{ op: 'ease', skill }], support: 2 })
      }
    } else if (rated.length > 0) {
      out.push({ skill, action: 'maintain', summary: `${SKILLS[skill].label}: only ${rated.length} rated session${rated.length === 1 ? '' : 's'} so far — keep the plan as it is.`,
        evidence: [`${rated.length} rated session(s); ${MIN_SESSIONS} are needed before changing anything.`], changes: [], support: rated.length })
    }
  }

  // Planned starts improving while reaction starts are not: add reaction work.
  const find = (slug: string) => input.lines.find(l => l.slug === slug)
  const planned = find('sprint_5y'), reactive = find('first_step_pct')
  if (planned && reactive && planned.direction === 'improved' && (reactive.direction === 'about_the_same' || reactive.direction === 'worse') && reactive.readings >= 2) {
    out.push({
      skill: 'first_step', action: 'modify',
      summary: 'Planned starts are getting faster but reaction starts are not. Consider adding controlled reaction-based starts instead of repeating the same planned starts.',
      evidence: [`${planned.label}: ${planned.baseline} → ${planned.latest}.`, `${reactive.label}: ${reactive.baseline} → ${reactive.latest} (${reactive.readings} readings, ${reactive.confidence} confidence).`],
      changes: [{ op: 'add_drill', skill: 'first_step', exerciseKey: 'reaction_start', minutes: 8 }], support: reactive.readings,
    })
  }

  for (const l of input.lines) {
    if (l.direction === 'worse' && l.readings >= 2 && l.confidence !== 'low') {
      out.push({ skill: null, action: 'reassess', summary: `${l.label} is below baseline. The coach should review the plan for this skill before the next phase.`,
        evidence: [`${l.label}: ${l.baseline} → ${l.latest}`], changes: [], support: l.readings })
    }
  }
  return out
}

// ── applying an approved proposal to FUTURE planned sessions only ────────────

const INTENSITY = ['easy', 'moderate', 'fast', 'game_speed'] as const

export function applyChanges(sessions: ProgramSession[], changes: Change[], fromDate: string): { sessions: ProgramSession[]; touched: string[] } {
  const out: ProgramSession[] = JSON.parse(JSON.stringify(sessions))
  const touched = new Set<string>()
  const future = out.filter(s => s.date >= fromDate && s.kind !== 'rest')
  for (const ch of changes) {
    if (ch.op === 'pause_throwing') {
      for (const s of future) {
        const had = s.blocks.length
        s.blocks = s.blocks.filter(b => b.kind !== 'throwing')
        if (s.blocks.length !== had) { s.minutes = s.blocks.reduce((a, b) => a + b.minutes, 0); s.requiresThrowingGate = false; touched.add(s.key) }
      }
    } else if (ch.op === 'add_drill') {
      const ex = EXERCISE_BY_KEY[ch.exerciseKey]; if (!ex) continue
      for (const s of future.filter(x => x.focus.includes(ch.skill) && (x.kind === 'coached'))) {
        const blk = s.blocks.find(b => b.skill === ch.skill && b.kind === 'skill'); if (!blk) continue
        if (blk.drills.some(d => d.exerciseKey === ex.key)) continue
        // Fit inside the block's existing minutes: take them from the last drill.
        const last = blk.drills[blk.drills.length - 1]
        const take = Math.min(ch.minutes, Math.max(0, last.minutes - 3))
        if (take < 3) continue
        last.minutes -= take
        blk.drills.push(toDrillRow(ex, take)); touched.add(s.key)
      }
    } else {
      const delta = ch.op === 'progress' ? 1 : -1
      for (const s of future) for (const b of s.blocks.filter(x => x.skill === ch.skill)) for (const d of b.drills) {
        const i = INTENSITY.indexOf(d.intensity as any) + delta
        // Never past 'fast' on a child's behalf: game-speed is a phase decision.
        const next = INTENSITY[Math.max(0, Math.min(2, i))]
        if (next !== d.intensity) { d.intensity = next; touched.add(s.key) }
      }
    }
  }
  return { sessions: out, touched: Array.from(touched) }
}
