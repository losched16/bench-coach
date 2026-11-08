// Dates, weeks and phases. Pure.

import { addDays, parseYmd, ymd } from './brief'
import type { ProgramPhase, SkillKey } from './types'
import { SKILLS } from './skills'

/** Day offsets (0 = first day of the week block) that carry a supervised session. */
export function trainingOffsets(n: number): number[] {
  const table: Record<number, number[]> = {
    1: [2], 2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5],
  }
  return table[Math.max(1, Math.min(6, n))]
}

/** Nth weekday (0=Sun..6=Sat) of a month, 1-based n. */
function nthWeekday(year: number, month0: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month0, 1)).getUTCDay()
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  return ymd(new Date(Date.UTC(year, month0, day)))
}

/** Days a family is not going to train. Only fixed, uncontroversial ones. */
export function holidayName(date: string): string | null {
  const y = Number(date.slice(0, 4))
  if (date === nthWeekday(y, 10, 4, 4)) return 'Thanksgiving'
  if (date.slice(5) === '12-25') return 'Christmas Day'
  if (date.slice(5) === '12-24') return 'Christmas Eve'
  if (date.slice(5) === '01-01') return 'New Year’s Day'
  return null
}

export interface WeekPlan { week: number; start: string; end: string; label: 'build' | 'consolidate' | 'deload' | 'assess' }

export function planWeeks(startDate: string, weeks: number): WeekPlan[] {
  const out: WeekPlan[] = []
  for (let w = 1; w <= weeks; w++) {
    const start = addDays(startDate, (w - 1) * 7)
    let label: WeekPlan['label'] = 'build'
    if (w === weeks && weeks >= 2) label = 'assess'
    else if (weeks >= 6 && w === Math.ceil(weeks / 2)) label = 'deload'
    else if (w > 1 && weeks >= 6 && w === Math.ceil(weeks / 2) + 1) label = 'consolidate'
    out.push({ week: w, start, end: addDays(start, 6), label })
  }
  return out
}

const PHASE_KEYS: Record<number, ProgramPhase['key'][]> = {
  1: ['foundation'],
  2: ['foundation', 'reactive'],
  3: ['foundation', 'controlled', 'reactive'],
  4: ['foundation', 'controlled', 'reactive', 'game_speed'],
  5: ['foundation', 'controlled', 'reactive', 'game_speed', 'evaluation'],
}
const PHASE_NAMES: Record<ProgramPhase['key'], string> = {
  foundation: 'Foundation', controlled: 'Controlled execution', reactive: 'Reactive execution',
  game_speed: 'Game-speed application', evaluation: 'Evaluation',
}
const PHASE_DIFFICULTY: Record<ProgramPhase['key'], string> = {
  foundation: 'Slow, planned movements with no surprises. Quality before speed.',
  controlled: 'Known targets and directions; add pace once form is steady.',
  reactive: 'The player has to read and respond; direction and timing are not known in advance.',
  game_speed: 'Game-like positions, pace and decisions with the same single cue.',
  evaluation: 'Re-test under the baseline conditions; no new skills.',
}

export function planPhases(startDate: string, weeks: number, skills: SkillKey[]): ProgramPhase[] {
  const count = Math.max(1, Math.min(5, Math.round(weeks / 2), weeks))
  const keys = PHASE_KEYS[count]
  const base = Math.floor(weeks / count)
  let extra = weeks - base * count
  const phases: ProgramPhase[] = []
  let cursor = 1
  keys.forEach((key, i) => {
    const len = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra--
    const startWeek = cursor, endWeek = cursor + len - 1
    cursor = endWeek + 1
    phases.push({
      order: i + 1, key, name: PHASE_NAMES[key],
      startDate: addDays(startDate, (startWeek - 1) * 7),
      endDate: addDays(startDate, endWeek * 7 - 1),
      startWeek, endWeek,
      goals: skills.map(s => `${SKILLS[s].label}: ${SKILLS[s].phaseFocus[key]}`).slice(0, 8),
      skills,
      progressionRequirements: [
        'Most reps meet the success marker with the same cue, across at least three sessions.',
        'No pain, unusual fatigue or loss of form during the work.',
        ...(i < keys.length - 1 ? ['The coach agrees the player is ready for the next phase.'] : ['Final assessment is complete and recorded.']),
      ],
      difficulty: PHASE_DIFFICULTY[key],
    })
  })
  return phases
}

export function phaseForWeek(phases: ProgramPhase[], week: number): ProgramPhase {
  return phases.find(p => week >= p.startWeek && week <= p.endWeek) || phases[phases.length - 1]
}

export function weekdayName(date: string): string {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][parseYmd(date).getUTCDay()]
}
