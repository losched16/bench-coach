// The deterministic composer.
//
// Given a brief, what we know about the player and the schedulable drill pool,
// build the COMPLETE program: every week, every session, every block, with
// drills and dosing. Nothing here calls a model, so the structure that matters
// for completeness and safety (all requested skills, all weeks, rest days,
// time budgets, supervision) cannot be lost to a bad generation. The model, if
// available, only adds coaching language on top (author.ts).

import type { DrillRecord } from '../drills'
import { addDays, weekday } from './brief'
import { holidayName, phaseForWeek, planPhases, planWeeks, trainingOffsets, weekdayName } from './calendar'
import { EMPTY_EVIDENCE, type PlayerEvidence } from './evidence'
import { EXERCISE_BY_KEY, EXERCISES, exerciseEquipmentOk, toDrillRow, type Exercise } from './exercises'
import { buildThrowingGate, ladderStepFor, requiredSupervision } from './safety'
import { candidatesFor, orderForPhase, rowFromDrill, type Candidate } from './select'
import { SKILLS } from './skills'
import type {
  AssessmentPlan, Block, DrillRow, ProgramBrief, ProgramDraft, ProgramPhase, ProgramSession, SkillKey, SkillPlan,
} from './types'

type PhaseKey = ProgramPhase['key']

const PHASE_STAGE_TARGET: Record<PhaseKey, number> = { foundation: 1, controlled: 1.5, reactive: 2, game_speed: 3, evaluation: 2 }

const WARMUP_MIN = 8
const COOLDOWN_MIN = 5

const BLOCK_ORDER: Record<SkillKey, number> = {
  first_step: 1, acceleration: 2, outfield_tracking: 3, infield_fundamentals: 4, hitting: 5,
  catching: 6, baserunning: 6, throwing: 6, strength_athleticism: 7, pitching_readiness: 8,
}

// ── priorities ───────────────────────────────────────────────────────────────

export function rankSkills(brief: ProgramBrief, ev: PlayerEvidence): SkillPlan[] {
  const n = brief.skills.length
  const scored = brief.skills.map((skill, i) => {
    let score = (n - i) * 1.0
    const reasons: string[] = []
    if (i < 3) reasons.push('listed among the first goals')
    const obs = ev.items.filter(e => e.skill === skill && (e.source === 'coach_observation' || e.source === 'recorded') && (e.bucket === 'needs' || e.bucket === 'concerns'))
    if (obs.length) { score += 2; reasons.push(`a recorded observation points here (${obs[0].text.slice(0, 80)})`) }
    const concern = brief.concerns.filter(c => c.skill === skill)
    if (concern.length) { score += 1.5; reasons.push('you flagged it as a concern') }
    const path = ev.pathways.find(p => p.skill === skill && p.status === 'active')
    if (path) { score += 1; reasons.push(`an active development plan (${path.pathwayName}) already covers it`) }
    // Throwing is capped: it can matter to the family and still be the wrong
    // thing to push while the arm status is unknown.
    if (skill === 'pitching_readiness' && brief.throwing.status !== 'active') {
      score = Math.min(score, 2.5); reasons.push('the arm is resting, so readiness comes before volume')
    }
    return { skill, score, reasons }
  })
  const sorted = [...scored].sort((a, b) => b.score - a.score || brief.skills.indexOf(a.skill) - brief.skills.indexOf(b.skill))
  return sorted.map((s, rank) => {
    const path = ev.pathways.find(p => p.skill === s.skill)
    const metric = SKILLS[s.skill].metrics.map(m => ev.metrics.find(r => r.slug === m.metricSlug)).find(Boolean)
    return {
      skill: s.skill, label: SKILLS[s.skill].label, priority: rank + 1,
      rationale: s.reasons.length ? `Priority ${rank + 1}: ${s.reasons.join('; ')}.` : `Priority ${rank + 1}: requested; no recorded evidence yet, so week 1 measures it.`,
      baseline: metric ? `${metric.label}: ${metric.value}${metric.unit ? ' ' + metric.unit : ''} on ${metric.on} (recorded)` : null,
      target: SKILLS[s.skill].targetPhrase,
      progressId: path?.progressId ?? null, pathwayName: path?.pathwayName ?? null, currentStage: path?.stageName ?? null,
    }
  })
}

// ── block allocation ─────────────────────────────────────────────────────────

/** Largest-remainder allocation of `capacity` blocks across skills, with floors. */
export function allocateBlocks(skills: SkillPlan[], capacity: number, credits?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  const n = skills.length
  if (n === 0) return out
  const fixed: Record<string, number> = {}
  const strength = skills.find(s => s.skill === 'strength_athleticism')
  if (strength) fixed.strength_athleticism = Math.min(2, Math.floor(capacity / 3) || 1)
  const pitch = skills.find(s => s.skill === 'pitching_readiness')
  if (pitch) fixed.pitching_readiness = 1
  let left = capacity - Object.values(fixed).reduce((a, b) => a + b, 0)
  const rest = skills.filter(s => !(s.skill in fixed))
  Object.assign(out, fixed)
  if (rest.length === 0) return out
  if (left < rest.length) {
    // Not enough blocks for every skill every week: the highest priorities get
    // one; the caller rotates the rest by week so each is still trained.
    // Weighted round-robin across weeks: every skill earns credit in proportion
    // to its priority each week, the highest balances get this week's blocks
    // and pay for them. Higher priorities come round more often; nobody is
    // starved, which is what "never silently drop a requested skill" requires.
    const cr = credits ?? {}
    const w = (s: SkillPlan) => 1 + (n - s.priority) * 0.35
    const total = rest.reduce((a, s) => a + w(s), 0)
    rest.forEach(s => { cr[s.skill] = (cr[s.skill] ?? 0) + w(s) })
    const chosen = [...rest].sort((a, b) => (cr[b.skill] - cr[a.skill]) || a.priority - b.priority).slice(0, left)
    rest.forEach(s => { out[s.skill] = chosen.includes(s) ? 1 : 0 })
    chosen.forEach(s => { cr[s.skill] -= total / Math.max(1, left) })
    return out
  }
  const weights = rest.map(s => 1 + (n - s.priority) * 0.35)
  const total = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => (w / total) * left)
  const base = raw.map(r => Math.max(1, Math.floor(r)))
  let used = base.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; used < left && k < order.length * 3; k++, used++) base[order[k % order.length].i]++
  while (used > left) { // trim the largest
    const j = base.indexOf(Math.max(...base)); if (base[j] <= 1) break; base[j]--; used--
  }
  rest.forEach((s, i) => { out[s.skill] = base[i] })
  return out
}

interface Slot { idx: number; cap: number; skills: SkillKey[] }

function place(counts: Record<string, number>, sessions: Slot[], strengthIdx: number[]): void {
  const dist = (a: number, b: number) => Math.abs(a - b)
  const placeOne = (skill: SkillKey, preferred?: number) => {
    const open = sessions.filter(s => s.skills.length < s.cap)
    if (!open.length) return
    if (preferred != null) {
      const s = sessions[preferred]; if (s && s.skills.length < s.cap && !s.skills.includes(skill)) { s.skills.push(skill); return }
    }
    const already = sessions.filter(s => s.skills.includes(skill)).map(s => s.idx)
    const fresh = open.filter(s => !s.skills.includes(skill))
    const pool = fresh.length ? fresh : open
    const best = [...pool].sort((a, b) => {
      const da = already.length ? Math.min(...already.map(x => dist(x, a.idx))) : 99
      const db = already.length ? Math.min(...already.map(x => dist(x, b.idx))) : 99
      if (da !== db) return db - da
      const ra = a.cap - a.skills.length, rb = b.cap - b.skills.length
      if (ra !== rb) return rb - ra
      return a.idx - b.idx
    })[0]
    best.skills.push(skill)
  }
  const sCount = counts.strength_athleticism || 0
  for (let i = 0; i < sCount; i++) placeOne('strength_athleticism', strengthIdx[i])
  const rest = Object.entries(counts).filter(([k]) => k !== 'strength_athleticism').sort((a, b) => b[1] - a[1])
  for (const [skill, n] of rest) for (let i = 0; i < n; i++) placeOne(skill as SkillKey)
}

// ── drills for a block ───────────────────────────────────────────────────────

interface Picker {
  pool: Map<SkillKey, Candidate[]>
  used: Map<string, number>
  gaps: Set<string>
}

function builtinsFor(skill: SkillKey, phase: PhaseKey, brief: ProgramBrief, wantSupervised: boolean): Exercise[] {
  return EXERCISES.filter(e =>
    e.skill === skill && e.kind !== 'warmup' && e.kind !== 'cooldown' && e.phases.includes(phase) &&
    e.minAge <= (brief.age ?? 9) && exerciseEquipmentOk(e, brief.equipment) &&
    (wantSupervised || e.supervision === 'independent'))
}

function buildSkillBlock(
  skill: SkillKey, minutes: number, phase: PhaseKey, picker: Picker, brief: ProgramBrief, occurrence: number,
): Block {
  const def = SKILLS[skill]
  const drills: DrillRow[] = []
  const isPhysical = def.family === 'physical'
  const lib = isPhysical || skill === 'pitching_readiness' ? [] : orderForPhase(picker.pool.get(skill) || [], phase)
  const builtin = builtinsFor(skill, phase, brief, true)
  const two = minutes >= 14
  const m1 = two ? Math.round(minutes * 0.6) : minutes
  const m2 = minutes - m1

  if (lib.length) {
    // Anchor: same drill every session of this phase for this skill.
    const anchor = lib[0]
    drills.push(rowFromDrill(anchor, skill, m1, phase))
    if (two) {
      // The second drill stays within one stage of the phase: a game-speed
      // drill must not show up in a controlled-reps block just because it ranks
      // next. Rotates between whatever qualifies so a phase is not monotone.
      const near = lib.slice(1).filter(c => Math.abs(c.stage - PHASE_STAGE_TARGET[phase]) <= 1)
      const pool2 = near.length ? near : lib.slice(1, 2)
      const alt = pool2.length ? pool2[occurrence % pool2.length] : null
      if (alt) drills.push(rowFromDrill(alt, skill, m2, phase))
      else if (builtin.length) drills.push({ ...toDrillRow(builtin[occurrence % builtin.length], m2) })
    }
  } else {
    if (!isPhysical && skill !== 'pitching_readiness') picker.gaps.add(`No curated library drill matched "${def.label}" (${phase}); built-in exercises were used. Consider curating a drill.`)
    const ex = builtin.length ? builtin : EXERCISES.filter(e => e.skill === skill && e.kind !== 'warmup' && e.kind !== 'cooldown' && exerciseEquipmentOk(e, brief.equipment))
    if (ex.length) {
      drills.push(toDrillRow(ex[occurrence % ex.length], m1))
      if (two && ex.length > 1) drills.push(toDrillRow(ex[(occurrence + 1) % ex.length], m2))
      else if (two) drills[0].minutes = minutes
    } else {
      drills.push(genericRow(skill, minutes, phase))
    }
  }
  const total = drills.reduce((a, d) => a + d.minutes, 0)
  if (total !== minutes && drills.length) drills[drills.length - 1].minutes += minutes - total
  const kind = skill === 'strength_athleticism' ? 'strength' : skill === 'pitching_readiness' || skill === 'throwing' ? 'throwing' : 'skill'
  return { kind, title: `${def.label} — ${phaseTitle(phase)}`, skill, minutes, drills }
}

function genericRow(skill: SkillKey, minutes: number, phase: PhaseKey): DrillRow {
  const def = SKILLS[skill]
  return {
    drillId: null, exerciseKey: null, name: `${def.label} practice`, skill, minutes, sets: 3, reps: '8 quality reps', rest: '30 sec',
    intensity: 'moderate', instructions: [def.phaseFocus[phase]], cues: [def.childCue], success: [], modification: 'Slow down and shorten the distance if form breaks.',
    equipment: [], hasVideo: false,
  }
}

function phaseTitle(p: PhaseKey): string {
  return { foundation: 'foundation', controlled: 'controlled reps', reactive: 'reactive reps', game_speed: 'game speed', evaluation: 'evaluation' }[p]
}

function throwingBlock(brief: ProgramBrief, week: number, minutes: number, readinessCheck: boolean, gate: ReturnType<typeof buildThrowingGate>): Block {
  const drills: DrillRow[] = []
  const arm = EXERCISE_BY_KEY.arm_care_bands
  const check = EXERCISE_BY_KEY.readiness_check
  const bands = exerciseEquipmentOk(arm, brief.equipment)
  if (readinessCheck) drills.push(toDrillRow(check, Math.min(10, minutes)))
  const step = ladderStepFor(gate, week - 1)
  const ladderStep = gate ? gate.ladder[Math.min(gate.ladder.length, Math.max(1, Math.ceil(week / 2)) + 0) - 1] : null
  const remain = minutes - drills.reduce((a, d) => a + d.minutes, 0)
  if (bands && remain >= 5) drills.push(toDrillRow(arm, readinessCheck ? Math.max(remain - 0, 5) : Math.min(remain, 6)))
  if (ladderStep && step >= 1) {
    const rem2 = minutes - drills.reduce((a, d) => a + d.minutes, 0)
    if (rem2 >= 3) drills.push({
      drillId: null, exerciseKey: `throw_ladder_${ladderStep.step}`,
      name: `Throwing ladder step ${ladderStep.step}: ${ladderStep.name} (only if the gate is cleared)`,
      skill: 'pitching_readiness', minutes: rem2, sets: null, reps: null, rest: null, intensity: 'easy',
      instructions: [ladderStep.description, 'Do this only if the coach has cleared the throwing gate AND the last session was pain-free. Otherwise repeat the arm-care circuit and legs-and-balance work instead.'],
      cues: ['Easy and smooth. Pain means stop.'], success: ['No pain during or after; mechanics stay clean at easy effort.'],
      modification: 'Drop back one step if there is any soreness, stiffness or fatigue.', equipment: [], hasVideo: false,
    })
  }
  if (!drills.length) drills.push(genericRow('pitching_readiness', minutes, 'foundation'))
  const total = drills.reduce((a, d) => a + d.minutes, 0)
  if (total !== minutes) drills[drills.length - 1].minutes += minutes - total
  return { kind: 'throwing', title: 'Pitching readiness (gated)', skill: 'pitching_readiness', minutes, drills }
}

// ── assessments ──────────────────────────────────────────────────────────────

function metricsFor(brief: ProgramBrief, skills: SkillKey[]): AssessmentPlan[] {
  const out: AssessmentPlan[] = []
  for (const s of skills) for (const m of SKILLS[s].metrics) {
    if (m.metricSlug === 'exit_velo' && !brief.equipment.some(e => /radar/i.test(e))) continue
    if (m.metricSlug === 'strike_pct') continue // only meaningful once throwing is cleared
    out.push(m)
  }
  return out
}

function assessmentBlock(metrics: AssessmentPlan[], minutes: number): Block {
  const per = Math.max(2, Math.floor(minutes / Math.max(1, metrics.length)))
  const drills: DrillRow[] = metrics.map(m => ({
    drillId: null, exerciseKey: `assess_${m.metricSlug}`, name: `Test: ${m.label}`, skill: m.skill, minutes: per,
    sets: null, reps: m.shape === 'challenge' ? `${m.attempts ?? 10} attempts` : '2–3 timed or measured tries', rest: 'full rest between tries', intensity: 'fast',
    instructions: [m.protocol, 'Write down the result straight away, with the conditions (surface, weather, who did the timing).'],
    cues: ['Same set-up every time.'], success: ['A result recorded under the same conditions as the baseline.'], modification: 'Skip a test if the player is sore or tired and note why.',
    equipment: [], hasVideo: false,
  }))
  const total = drills.reduce((a, d) => a + d.minutes, 0)
  if (drills.length && total !== minutes) drills[drills.length - 1].minutes += minutes - total
  return { kind: 'assessment', title: 'Checkpoint measurements', skill: null, minutes, drills }
}

// ── independent routines ─────────────────────────────────────────────────────

function independentFor(brief: ProgramBrief, focus: SkillKey[], phase: PhaseKey, key: string, date: string, week: number): ProgramSession {
  const cands = EXERCISES.filter(e => e.supervision === 'independent' && e.kind !== 'warmup' && e.kind !== 'cooldown' &&
    e.phases.includes(phase) && e.minAge <= (brief.age ?? 9) && exerciseEquipmentOk(e, brief.equipment))
  const picked: Exercise[] = []
  for (const s of [...focus, 'strength_athleticism' as SkillKey]) {
    const e = cands.find(c => c.skill === s && !picked.includes(c))
    if (e) picked.push(e)
    if (picked.length === 2) break
  }
  if (!picked.length) picked.push(EXERCISE_BY_KEY.balance_landing)
  const each = Math.max(2, Math.floor(brief.independentMinutes / picked.length))
  const drills = picked.map((e, i) => toDrillRow(e, i === picked.length - 1 ? brief.independentMinutes - each * (picked.length - 1) : each))
  const block: Block = { kind: 'skill', title: 'Independent routine', skill: picked[0].skill, minutes: brief.independentMinutes, drills }
  return {
    key, week, date, kind: 'independent', supervision: 'independent', title: 'Independent routine (easy)',
    focus: Array.from(new Set(picked.map(p => p.skill))), minutes: brief.independentMinutes, blocks: [block],
    checkpoint: null, assessments: [], requiresThrowingGate: false,
    coachNote: 'Easy effort, no throwing, no max lifts. Stop if anything hurts. Mark it done when finished.',
    filmingNote: null, equipment: [], origin: 'ai',
  }
}

// ── the whole thing ──────────────────────────────────────────────────────────

export interface ComposeInput {
  brief: ProgramBrief
  evidence?: PlayerEvidence
  pool: DrillRecord[]
}

export function composeDraft(input: ComposeInput): ProgramDraft {
  const { brief, pool } = input
  const ev = input.evidence ?? EMPTY_EVIDENCE
  const skillPlans = rankSkills(brief, ev)
  const phases = planPhases(brief.startDate, brief.weeks, brief.skills)
  const weeks = planWeeks(brief.startDate, brief.weeks)
  const gate = buildThrowingGate(brief)
  const picker: Picker = { pool: new Map(), used: new Map(), gaps: new Set() }
  for (const s of brief.skills) if (SKILLS[s].family === 'baseball' || s === 'throwing') picker.pool.set(s, candidatesFor(s, pool, brief))

  const offsets = trainingOffsets(brief.supervisedDaysPerWeek)
  const S = offsets.length
  const strengthIdx = S >= 4 ? [0, 3] : S === 3 ? [0, 2] : S === 2 ? [0, 1] : [0]
  const sessions: ProgramSession[] = []
  const occurrence = new Map<string, number>()
  const credits: Record<string, number> = {}
  const warnings: string[] = []
  const baselineMetrics = metricsFor(brief, brief.skills)

  // Skills for assessment halves: speed + strength together, then skill work.
  const half = (a: boolean) => brief.skills.filter(s => (['first_step', 'acceleration', 'strength_athleticism', 'baserunning'] as SkillKey[]).includes(s) === a)

  weeks.forEach((wk, wi) => {
    const phase = phaseForWeek(phases, wk.week)
    const capPer = brief.sessionMinutes >= 80 ? 3 : 2
    const slots: Slot[] = offsets.map((_, i) => ({ idx: i, cap: capPer, skills: [] }))
    // Checkpoint sessions: first two coached sessions of week 1, of the
    // midpoint week and of the final week. They carry fewer skill blocks.
    const checkpoint: ProgramSession['checkpoint'] =
      wk.week === 1 ? 'baseline' : (wk.week === brief.weeks && brief.weeks >= 2) ? 'final'
        : (brief.weeks >= 4 && wk.week === Math.ceil(brief.weeks / 2)) ? 'midpoint' : null
    const cpIdx = checkpoint ? (checkpoint === 'baseline' ? [0, 1] : [S - 2 >= 0 ? S - 2 : 0, S - 1]) : []
    const cpSet = Array.from(new Set(cpIdx.filter(i => i < S)))

    // Fewer blocks than skills (few sessions a week): skills rotate by credit.
    const capacity = slots.reduce((a, s) => a + (cpSet.includes(s.idx) ? 1 : s.cap), 0)
    if (skillPlans.length > capacity && wi === 0) warnings.push('With this few sessions per week, not every skill fits every week; skills rotate week to week.')
    slots.forEach(s => { if (cpSet.includes(s.idx)) s.cap = 1 })
    const counts = allocateBlocks(skillPlans, slots.reduce((a, s) => a + s.cap, 0), credits)
    const free = slots.map(x => x.idx).filter(i => !cpSet.includes(i))
    const pref = cpSet.length ? (free.length >= 2 ? [free[0], free[free.length - 1]] : free) : strengthIdx
    place(counts, slots, pref)

    offsets.forEach((off, i) => {
      const date = addDays(wk.start, off)
      const key = `w${wk.week}d${off + 1}`
      const slot = slots[i]
      const isCp = checkpoint && cpSet.includes(i)
      const focusSkills = [...slot.skills].sort((a, b) => BLOCK_ORDER[a] - BLOCK_ORDER[b])
      const blocks: Block[] = []
      blocks.push({ kind: 'warmup', title: 'Warm-up', skill: null, minutes: WARMUP_MIN, drills: [toDrillRow(EXERCISE_BY_KEY.dynamic_warmup, WARMUP_MIN)] })

      let cpMetrics: AssessmentPlan[] = []
      let cpMin = 0
      if (isCp) {
        const which = cpSet.indexOf(i) === 0 ? half(true) : half(false)
        // Only the metrics that fit; lowest priority dropped first.
        cpMetrics = metricsFor(brief, which.length ? which : brief.skills)
        const budget = brief.sessionMinutes - WARMUP_MIN - COOLDOWN_MIN - (focusSkills.length ? 12 : 0)
        while (cpMetrics.length * 4 > budget && cpMetrics.length > 1) {
          const dropped = cpMetrics.pop()!; warnings.push(`Checkpoint at ${key}: "${dropped.label}" did not fit the session length and was left out.`)
        }
        cpMin = Math.min(budget, Math.max(4, cpMetrics.length * 5))
        if (cpMetrics.length) blocks.push(assessmentBlock(cpMetrics, cpMin))
      }

      const contentMin = brief.sessionMinutes - WARMUP_MIN - COOLDOWN_MIN - cpMin
      const nBlocks = focusSkills.length
      let used = 0
      focusSkills.forEach((skill, bi) => {
        const m = bi === nBlocks - 1 ? contentMin - used : Math.floor(contentMin / nBlocks)
        used += m
        const occKey = `${skill}`
        const occ = occurrence.get(occKey) ?? 0; occurrence.set(occKey, occ + 1)
        if (skill === 'pitching_readiness') {
          blocks.push(throwingBlock(brief, wk.week, m, !!isCp || wk.week === 1 || wk.week % 4 === 0, gate))
        } else {
          blocks.push(buildSkillBlock(skill, m, phase.key, picker, brief, occ))
        }
      })
      blocks.push({ kind: 'cooldown', title: 'Cool-down and review', skill: null, minutes: COOLDOWN_MIN, drills: [toDrillRow(EXERCISE_BY_KEY.cooldown_mobility, COOLDOWN_MIN)] })

      const hasThrow = blocks.some(b => b.kind === 'throwing')
      const hasStrength = blocks.some(b => b.kind === 'strength')
      const kind: ProgramSession['kind'] = isCp ? 'assessment' : 'coached'
      const equipment = Array.from(new Set(blocks.flatMap(b => b.drills.flatMap(d => d.equipment))))
      const session: ProgramSession = {
        key, week: wk.week, date, kind, supervision: 'parent',
        title: isCp ? `${cap(checkpoint!)} checkpoint — ${weekdayName(date)}` : `${weekdayName(date)} — ${focusSkills.slice(0, 2).map(s => SKILLS[s].label.split(' ')[0] === 'Athletic' ? 'Strength' : SKILLS[s].label.split(/[ ,:]/)[0]).join(' + ') || 'Skills'}`,
        focus: focusSkills, minutes: blocks.reduce((a, b) => a + b.minutes, 0), blocks,
        checkpoint: isCp ? checkpoint : null, assessments: cpMetrics,
        requiresThrowingGate: hasThrow, equipment,
        coachNote: `${phase.name}: ${focusSkills.slice(0, 2).map(s => SKILLS[s].phaseFocus[phase.key]).join(' ')}`.slice(0, 480),
        filmingNote: null, origin: 'ai',
      }
      session.supervision = requiredSupervision(session) === 'independent' ? 'parent' : requiredSupervision(session)
      if (hasStrength) session.supervision = 'parent'
      sessions.push(session)

      if (brief.independentMinutes > 0) {
        sessions.push(independentFor(brief, focusSkills.filter(s => s !== 'pitching_readiness'), phase.key, `${key}i`, date, wk.week))
      }
    })

    // Rest days: every date of the week without a coached session.
    for (let d = 0; d < 7; d++) {
      if (offsets.includes(d)) continue
      sessions.push({
        key: `w${wk.week}d${d + 1}`, week: wk.week, date: addDays(wk.start, d), kind: 'rest', supervision: 'independent',
        title: 'Rest day', focus: [], minutes: 0, blocks: [], checkpoint: null, assessments: [], requiresThrowingGate: false,
        coachNote: 'Rest is part of the program. Play, walk, sleep and eat well. No structured training.',
        filmingNote: null, equipment: [], origin: 'ai',
      })
    }
  })

  // Holidays: move a coached session off the day to a free rest day that week.
  for (const s of sessions.filter(x => x.kind === 'coached' || x.kind === 'assessment')) {
    const name = holidayName(s.date)
    if (!name) continue
    // Of the free days that week, take the one that leaves the longest run of
    // training days shortest — Thanksgiving next to a holiday week must not
    // quietly produce six days in a row.
    const rests = sessions.filter(r => r.kind === 'rest' && r.week === s.week && !holidayName(r.date))
    const rest = rests.sort((a, b) => longestRun(sessions, s, a) - longestRun(sessions, s, b) || a.date.localeCompare(b.date))[0]
    if (!rest) { s.coachNote = `${s.coachNote ?? ''} (${name}: shorten or skip if the family is away.)`.trim().slice(0, 500); continue }
    const indep = sessions.find(x => x.key === `${s.key}i`)
    const oldDate = s.date
    s.date = rest.date; rest.date = oldDate
    if (indep) indep.date = s.date
    s.coachNote = `${s.coachNote ?? ''} (Moved off ${name}.)`.trim().slice(0, 500)
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))

  if (brief.filming) {
    const coached = sessions.filter(s => s.kind === 'coached' || s.kind === 'assessment')
    const every = Math.max(1, Math.floor(coached.length / Math.max(1, brief.weeks * 2)))
    coached.forEach((s, i) => {
      if (i % (every * Math.ceil(S / 2)) === 0 || s.checkpoint) {
        s.filmingNote = s.checkpoint
          ? 'Good session to film: record each test attempt so viewers can see the before/after at the final checkpoint. Film from the side and behind at the same angle each time.'
          : 'Filmable: pick one drill, film a clean rep and one common miss from the side, and say the single cue out loud. Keep the camera angle consistent across weeks.'
      }
    })
  }

  const weeklyLoad = weeks.map(w => ({
    week: w.week, label: w.label,
    note: { build: 'Normal training load.', consolidate: 'Repeat and lock in; no new skills.', deload: 'Lighter volume to absorb the work; checkpoint tests.', assess: 'Re-test and review; no new skills.' }[w.label],
  }))

  const progressionRules = buildRules(brief)
  const assumptions = [...brief.assumptions]
  const draft: ProgramDraft = {
    schemaVersion: 1,
    title: `${brief.playerName ? brief.playerName + ': ' : ''}${brief.weeks}-week development program`,
    summary: summarise(brief, skillPlans, phases, S),
    brief, assessment: buildAssessment(brief, ev, skillPlans),
    skills: skillPlans, phases, sessions, progressionRules, throwingGate: gate, weeklyLoad,
    curationFlags: Array.from(picker.gaps), assumptions, qualityReport: { checks: [], repairs: [], warnings },
    generation: null,
  }
  return draft
}

export function longestRun(all: ProgramSession[], moved: ProgramSession, target: ProgramSession): number {
  const train = new Set(all.filter(x => (x.kind === 'coached' || x.kind === 'assessment') && x !== moved).map(x => x.date))
  train.add(target.date)
  let max = 0, run = 0
  for (const d of Array.from(new Set(all.map(x => x.date))).sort()) { if (train.has(d)) { run++; max = Math.max(max, run) } else run = 0 }
  return max
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function summarise(brief: ProgramBrief, skills: SkillPlan[], phases: ProgramPhase[], s: number): string {
  const top = skills.slice(0, 3).map(x => x.label).join(', ')
  return `${brief.weeks} weeks starting ${brief.startDate}: ${s} supervised sessions a week` +
    `${brief.independentMinutes ? ` plus a ${brief.independentMinutes}-minute independent routine on those days` : ''}, and at least one rest day every week. ` +
    `Most time goes to ${top}. Every requested skill is trained every week${skills.length > s * 2 ? ' or rotated across weeks' : ''}. ` +
    `${phases.length} phases (${phases.map(p => p.name.toLowerCase()).join(' → ')}), with baseline, ${brief.weeks >= 4 ? 'midpoint and ' : ''}final checkpoints. ` +
    `Nothing is saved until you review and approve it.`
}

function buildAssessment(brief: ProgramBrief, ev: PlayerEvidence, skills: SkillPlan[]): ProgramDraft['assessment'] {
  const pick = (b: string) => ev.items.filter(i => i.bucket === b).map(({ bucket, ...e }) => e)
  const concerns = [
    ...pick('concerns'),
    ...brief.concerns.map(c => ({ source: 'user_reported' as const, text: c.text, skill: c.skill, on: null })),
  ]
  const unknowns = [...pick('unknowns')]
  if (ev.loggedSessions60d === 0) unknowns.push({ source: 'missing' as const, text: 'No recent sessions are logged. That does not mean no practice happened — unlogged work is simply unknown.', skill: null, on: null })
  if (brief.throwing.status !== 'active') unknowns.push({ source: 'missing' as const, text: 'Length of the arm rest and any pain history were not recorded; throwing stays gated until a coach confirms.', skill: 'pitching_readiness', on: null })
  for (const s of skills) if (!s.baseline) unknowns.push({ source: 'missing' as const, text: `No recorded baseline for ${s.label}; week 1 measures it.`, skill: s.skill, on: null })
  return { strengths: pick('strengths'), needs: pick('needs'), concerns, history: pick('history'), unknowns }
}

function buildRules(brief: ProgramBrief): ProgramDraft['progressionRules'] {
  const rules: ProgramDraft['progressionRules'] = []
  for (const s of brief.skills) {
    const l = SKILLS[s].label
    rules.push(
      { skill: s, action: 'advance', when: `${l}: the player meets the success markers on most reps in three sessions in a row with the same cue, and the work feels easy.` },
      { skill: s, action: 'maintain', when: `${l}: results are steady but not yet consistent — keep the current drill and level for another week.` },
      { skill: s, action: 'regress', when: `${l}: form breaks down or the player gets frustrated on two sessions in a row — use the easier variation listed on the drill.` },
      { skill: s, action: 'repeat', when: `${l}: one unusually good or bad session is not a trend. Repeat it before changing anything.` },
    )
  }
  rules.push(
    { skill: null, action: 'pause', when: 'Any pain, swelling or unusual fatigue: stop that work, rest, and tell the coach before continuing.' },
    { skill: null, action: 'reassess', when: 'A checkpoint result is worse than baseline twice, or the player has missed two weeks: the coach reviews the plan before the next phase.' },
  )
  return rules
}
