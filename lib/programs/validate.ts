// Deterministic quality checks on a draft, and repairs for the ones that can
// be repaired without asking a model again.
//
// These are the "did we do what was asked, and is it safe to hand to a parent"
// questions. They run on every draft (generated, model-enriched, or edited by
// the coach) and the results are shown in the editor.

import { addDays } from './brief'
import { holidayName } from './calendar'
import { DraftSchema, type ProgramDraft, type ProgramSession } from './types'
import { independenceViolations, requiredSupervision } from './safety'

export interface Check { id: string; ok: boolean; detail: string }

const COACHED = (s: ProgramSession) => s.kind === 'coached' || s.kind === 'assessment'

export function validateDraft(draft: ProgramDraft, opts: { drillIds?: Set<string> } = {}): Check[] {
  const b = draft.brief
  const checks: Check[] = []
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

  const schema = DraftSchema.safeParse(draft)
  add('schema', schema.success, schema.success ? 'Draft matches the program schema.' : schema.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; '))

  // 1. every requested skill trained
  const trained = new Set(draft.sessions.filter(s => s.kind !== 'rest').flatMap(s => s.blocks.filter(x => x.kind !== 'warmup' && x.kind !== 'cooldown').map(x => x.skill)))
  const missing = b.skills.filter(s => !trained.has(s))
  add('skills_covered', missing.length === 0, missing.length ? `Not trained anywhere: ${missing.join(', ')}` : 'Every requested skill appears in the schedule.')

  // 2. timeline
  const weeks = new Set(draft.sessions.map(s => s.week))
  const gaps: number[] = []
  for (let w = 1; w <= b.weeks; w++) if (!weeks.has(w)) gaps.push(w)
  const lastDate = draft.sessions.reduce((a, s) => (s.date > a ? s.date : a), '')
  add('timeline', gaps.length === 0 && lastDate <= addDays(b.startDate, b.weeks * 7 - 1) && draft.sessions.every(s => s.date >= b.startDate),
    gaps.length ? `Weeks with no sessions: ${gaps.join(', ')}` : `Covers ${b.weeks} weeks from ${b.startDate}.`)

  // 3. per-skill weekly coverage (rotation allowed only if flagged)
  const rotating = (draft.qualityReport?.warnings || []).some(w => /rotate/i.test(w))
  if (!rotating) {
    const thin: string[] = []
    for (let w = 1; w <= b.weeks; w++) {
      const inWeek = new Set(draft.sessions.filter(s => s.week === w && s.kind !== 'rest').flatMap(s => s.blocks.map(x => x.skill)))
      for (const sk of b.skills) if (!inWeek.has(sk)) thin.push(`w${w}:${sk}`)
    }
    add('weekly_coverage', thin.length === 0, thin.length ? `Skill missing in a week: ${thin.slice(0, 6).join(', ')}` : 'Every skill is trained every week.')
  }

  // 4. all sessions fully specified + time budget
  const bad: string[] = []
  for (const s of draft.sessions) {
    if (s.kind === 'rest') continue
    const sum = s.blocks.reduce((a, x) => a + x.minutes, 0)
    const budget = s.kind === 'independent' ? b.independentMinutes : b.sessionMinutes
    if (s.minutes !== sum) bad.push(`${s.key} minutes ${s.minutes}≠${sum}`)
    else if (sum > budget) bad.push(`${s.key} ${sum}>${budget} min`)
    for (const bl of s.blocks) {
      const dsum = bl.drills.reduce((a, d) => a + d.minutes, 0)
      if (bl.drills.length === 0 || dsum !== bl.minutes) bad.push(`${s.key}/${bl.title} drill minutes ${dsum}≠${bl.minutes}`)
    }
  }
  add('time_budget', bad.length === 0, bad.length ? bad.slice(0, 4).join('; ') : 'Every session’s blocks add up and fit the time budget.')

  // 5. actionable drill instructions
  const thinDrills: string[] = []
  for (const s of draft.sessions) for (const bl of s.blocks) for (const d of bl.drills)
    if (d.instructions.length === 0 && bl.kind !== 'cooldown') thinDrills.push(`${s.key}:${d.name}`)
  add('instructions', thinDrills.length === 0, thinDrills.length ? `No instructions: ${thinDrills.slice(0, 4).join(', ')}` : 'Every drill has written instructions.')

  // 6. referenced drill ids exist
  if (opts.drillIds) {
    const unknown = Array.from(new Set(draft.sessions.flatMap(s => s.blocks.flatMap(bl => bl.drills.map(d => d.drillId)))
      .filter((id): id is string => !!id && !opts.drillIds!.has(id))))
    add('drill_ids', unknown.length === 0, unknown.length ? `Unknown drill ids: ${unknown.slice(0, 3).join(', ')}` : 'All referenced drills exist in the library.')
  }

  // 7. unique session keys; one coached session and one independent routine per date at most
  const keys = new Set<string>(); const dups: string[] = []
  const perDay = new Map<string, number>()
  for (const s of draft.sessions) {
    if (keys.has(s.key)) dups.push(s.key); keys.add(s.key)
    if (COACHED(s)) perDay.set(s.date, (perDay.get(s.date) || 0) + 1)
  }
  const doubled = Array.from(perDay).filter(([, n]) => n > 1).map(([d]) => d)
  add('unique_sessions', dups.length === 0 && doubled.length === 0, dups.length || doubled.length ? `Duplicate keys: ${dups.join(',')} double-booked: ${doubled.join(',')}` : 'No duplicate session ids or double-booked days.')

  // 8. recovery
  const noRest: number[] = []
  for (let w = 1; w <= b.weeks; w++) if (!draft.sessions.some(s => s.week === w && s.kind === 'rest')) noRest.push(w)
  const runs = restRuns(draft)
  add('recovery', noRest.length === 0 && runs <= 5, noRest.length ? `No rest day in weeks ${noRest.join(', ')}` : runs > 5 ? `${runs} training days in a row` : 'Every week has at least one rest day.')

  // 9. workload for age
  const heavy: string[] = []
  const byDate = new Map<string, number>()
  for (const s of draft.sessions) if (s.kind !== 'rest') byDate.set(s.date, (byDate.get(s.date) || 0) + s.minutes)
  const cap = (b.age ?? 9) <= 10 ? 90 : 120
  byDate.forEach((m, d) => { if (m > cap) heavy.push(`${d} ${m}min`) })
  const hard = draft.sessions.filter(s => s.blocks.some(bl => bl.drills.some(d => d.intensity === 'game_speed' && bl.kind === 'throwing')))
  add('workload', heavy.length === 0 && hard.length === 0, heavy.length ? `Over ${cap} minutes in a day: ${heavy.slice(0, 3).join(', ')}` : hard.length ? 'Game-speed throwing is scheduled.' : `No day exceeds ${cap} minutes; no game-speed throwing.`)

  // 10. safety: independence and throwing gate
  const viol = draft.sessions.flatMap(independenceViolations)
  const gateOpenMisuse = draft.throwingGate && !draft.throwingGate.cleared
    ? draft.sessions.filter(s => s.blocks.some(bl => bl.drills.some(d => /strike|velocity|bullpen|mound/i.test(d.name)))).map(s => s.key) : []
  const supMismatch = draft.sessions.filter(s => s.kind !== 'rest' && rank(s.supervision) < rank(requiredSupervision(s))).map(s => s.key)
  add('safety', viol.length === 0 && gateOpenMisuse.length === 0 && supMismatch.length === 0,
    [...viol, ...gateOpenMisuse.map(k => `${k} schedules pitching volume while the throwing gate is closed`), ...supMismatch.map(k => `${k} supervision is below what its drills need`)].slice(0, 4).join('; ') ||
    'Independent work is safe as labelled and throwing stays gated.')
  if (b.skills.includes('pitching_readiness')) add('throwing_gate', !!draft.throwingGate && !draft.throwingGate.cleared, draft.throwingGate ? 'Throwing gate present and closed until a coach clears it.' : 'Pitching was requested but there is no throwing gate.')

  // 11. measurable checkpoints
  const cps = new Set(draft.sessions.map(s => s.checkpoint).filter(Boolean))
  const needMid = b.weeks >= 4
  add('assessments', cps.has('baseline') && (b.weeks < 2 || cps.has('final')) && (!needMid || cps.has('midpoint')) && draft.sessions.some(s => s.assessments.length > 0),
    `Checkpoints present: ${Array.from(cps).join(', ') || 'none'}.`)

  // 12. facts vs assumptions
  add('assumptions_stated', b.assumptions.length === draft.assumptions.length, 'Assumptions are listed for the coach to revise.')

  // 13. holidays and executable dates
  const hol = draft.sessions.filter(s => (s.kind === 'coached' || s.kind === 'assessment') && holidayName(s.date)).map(s => `${s.date} ${holidayName(s.date)}`)
  add('executable', hol.length === 0, hol.length ? `Training scheduled on ${hol.join(', ')}` : 'No sessions fall on common family holidays.')

  // phases cover every week with no gaps
  let cursor = 1; let phaseOk = true
  for (const p of [...draft.phases].sort((a, c) => a.order - c.order)) { if (p.startWeek !== cursor) phaseOk = false; cursor = p.endWeek + 1 }
  add('phases', phaseOk && cursor === b.weeks + 1, phaseOk && cursor === b.weeks + 1 ? 'Phases are contiguous and cover every week.' : 'Phases do not cover the weeks.')
  return checks
}

const rank = (s: string) => ({ independent: 0, parent: 1, coach: 2 } as Record<string, number>)[s] ?? 1

function restRuns(draft: ProgramDraft): number {
  const trainDates = new Set(draft.sessions.filter(COACHED).map(s => s.date))
  let max = 0, run = 0
  const dates = Array.from(new Set(draft.sessions.map(s => s.date))).sort()
  for (const d of dates) { if (trainDates.has(d)) { run++; max = Math.max(max, run) } else run = 0 }
  return max
}

/**
 * Repairs that need no model. Returns a list of what was changed; the caller
 * records it in qualityReport.repairs so nothing is silently altered.
 */
export function repairDraft(draft: ProgramDraft): string[] {
  const repairs: string[] = []
  for (const s of draft.sessions) {
    if (s.kind === 'rest') continue
    for (const bl of s.blocks) {
      const dsum = bl.drills.reduce((a, d) => a + d.minutes, 0)
      if (bl.drills.length && dsum !== bl.minutes) { bl.drills[bl.drills.length - 1].minutes = Math.max(1, bl.drills[bl.drills.length - 1].minutes + bl.minutes - dsum); repairs.push(`${s.key}: rebalanced drill minutes in "${bl.title}"`) }
    }
    const sum = s.blocks.reduce((a, x) => a + x.minutes, 0)
    if (s.minutes !== sum) { s.minutes = sum; repairs.push(`${s.key}: corrected total minutes to ${sum}`) }
    const need = requiredSupervision(s)
    if (rank(s.supervision) < rank(need)) { s.supervision = need; repairs.push(`${s.key}: raised supervision to ${need}`) }
    if (s.kind === 'independent' && s.supervision !== 'independent') { s.kind = 'coached'; repairs.push(`${s.key}: no longer independent — contains supervised work`) }
  }
  return repairs
}
