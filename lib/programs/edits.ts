// Follow-up edits to an open draft: "Make Thursday a rest day", "Show me
// Week 4", "Add more outfield work", "Change this to three days per week",
// "Replace that drill with one I can do indoors".
//
// Each edit is turned into an explicit operation first (parseEdit) and applied
// separately (apply*). Operations that need the drill library or a re-plan are
// returned as intents for the caller to run; nothing here reads a database.

import type { DrillRecord } from '../drills'
import { environmentEligible } from '../drillEligibility'
import { addDays, weekday } from './brief'
import { longestRun } from './compose'
import { holidayName } from './calendar'
import { detectSkills, SKILLS } from './skills'
import { candidatesFor, rowFromDrill } from './select'
import type { ProgramBrief, ProgramDraft, ProgramSession, SkillKey } from './types'
import { requiredSupervision } from './safety'

export type EditOp =
  | { kind: 'rest_day'; weekday: number }
  | { kind: 'show_week'; week: number }
  | { kind: 'days_per_week'; days: number }
  | { kind: 'more_skill'; skill: SkillKey }
  | { kind: 'replace_drill'; target: string | null; indoor: boolean }

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()])

export function parseEdit(message: string): EditOp | null {
  const m = message.trim()
  const rest = /\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)\w*\b.{0,30}\b(rest|off|recovery)\b|\b(rest|off)\b.{0,15}\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)\w*/i.exec(m)
  if (rest) {
    const word = (rest[1] || rest[4] || '').slice(0, 3).toLowerCase()
    const idx = DAYS.indexOf(word)
    if (idx >= 0) return { kind: 'rest_day', weekday: idx }
  }
  const show = /\b(?:show|open|see|go to|view)\b.{0,15}\bweek\s*(\d{1,2}|one|two|three|four|five|six|seven|eight)\b/i.exec(m)
  if (show) return { kind: 'show_week', week: num(show[1]) }
  const dpw = /\b(one|two|three|four|five|six|\d)\s*(?:supervised\s*)?days?\s*(?:a|per)\s*week\b/i.exec(m)
  if (dpw && /\b(change|make|switch|set|go|do|only|instead)\b/i.test(m)) return { kind: 'days_per_week', days: Math.max(1, Math.min(6, num(dpw[1]))) }
  const more = /\badd (?:more|some|extra)\b(.*)/i.exec(m) || /\bmore\b(.*?)\b(?:work|time|reps|practice)\b/i.exec(m)
  if (more) {
    const sk = detectSkills(more[1] || m)[0]
    if (sk) return { kind: 'more_skill', skill: sk }
  }
  if (/\b(replace|swap|substitute|change)\b.{0,60}\b(drill|exercise)\b|\b(indoors?|inside)\b.{0,30}\b(instead|version|alternative|option)\b|\b(replace|swap)\b\s*["“']|\b(replace|swap)\b.{0,80}\b(indoors?|inside)\b/i.test(m)) {
    const q = /["“']([^"”']{3,60})["”']/.exec(m)
    return { kind: 'replace_drill', target: q ? q[1] : null, indoor: /\b(indoors?|inside|garage|basement|gym)\b/i.test(m) }
  }
  return null
}

export interface EditResult { ok: boolean; message: string; changed: string[]; draft: ProgramDraft }

/** Move each week's coached session off the given weekday onto that week's free day. */
export function applyRestDay(draft: ProgramDraft, wd: number): EditResult {
  const out: ProgramDraft = JSON.parse(JSON.stringify(draft))
  const changed: string[] = []
  const isCoached = (s: ProgramSession) => s.kind === 'coached' || s.kind === 'assessment'
  for (let w = 1; w <= out.brief.weeks; w++) {
    const s = out.sessions.find(x => x.week === w && isCoached(x) && weekday(x.date) === wd)
    if (!s) continue
    const rests = out.sessions.filter(r => r.week === w && r.kind === 'rest' && weekday(r.date) !== wd && !holidayName(r.date))
    const target = rests.sort((a, b) => longestRun(out.sessions, s, a) - longestRun(out.sessions, s, b) || a.date.localeCompare(b.date))[0]
    if (!target) continue
    const oldDate = s.date
    s.date = target.date; target.date = oldDate
    const indep = out.sessions.find(x => x.key === `${s.key}i`)
    if (indep) indep.date = s.date
    s.origin = 'coach'
    target.title = 'Rest day'
    changed.push(s.key)
  }
  out.sessions.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]
  return changed.length
    ? { ok: true, message: `${name} is now a rest day. I moved ${changed.length} session${changed.length === 1 ? '' : 's'} to the free day in the same week.`, changed, draft: out }
    : { ok: false, message: `There were no coached sessions on ${name}s to move, so nothing changed.`, changed, draft }
}

/** The brief to re-plan with. The caller regenerates; the open draft is replaced, never a saved program. */
export function briefForEdit(brief: ProgramBrief, op: EditOp): ProgramBrief | null {
  if (op.kind === 'days_per_week') {
    return { ...brief, supervisedDaysPerWeek: op.days, assumptions: [...brief.assumptions.filter(a => !/frequency/i.test(a)), `Changed to ${op.days} supervised days a week at your request.`] }
  }
  if (op.kind === 'more_skill') {
    const skills = [op.skill, ...brief.skills.filter(s => s !== op.skill)]
    return { ...brief, skills, assumptions: [...brief.assumptions, `${SKILLS[op.skill].label} moved to top priority at your request.`] }
  }
  return null
}

function words(s: string) { return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)) }

/** Replace a library drill (or every occurrence of it) with an eligible alternative. */
export function applyReplaceDrill(
  draft: ProgramDraft, op: Extract<EditOp, { kind: 'replace_drill' }>, pool: DrillRecord[], lastTouched?: string | null,
): EditResult {
  const out: ProgramDraft = JSON.parse(JSON.stringify(draft))
  const names = Array.from(new Set(out.sessions.flatMap(s => s.blocks.flatMap(b => b.drills.filter(d => d.drillId).map(d => d.name)))))
  const wanted = op.target || lastTouched || null
  let name: string | null = null
  if (wanted) {
    const w = words(wanted)
    name = names.map(n => ({ n, hit: Array.from(words(n)).filter(x => w.has(x)).length })).sort((a, b) => b.hit - a.hit)[0]?.n || null
    if (name && Array.from(words(name)).filter(x => w.has(x)).length === 0) name = null
  }
  if (!name) return { ok: false, message: 'Tell me which drill, in quotes (for example: replace "Tee Work" with one I can do indoors), and I’ll swap it.', changed: [], draft }
  const sample = out.sessions.flatMap(s => s.blocks.flatMap(b => b.drills)).find(d => d.name === name)!
  const cands = candidatesFor(sample.skill, pool, out.brief)
    .filter(c => c.drill.id !== sample.drillId && (!op.indoor || environmentEligible(c.drill, 'indoor')))
  if (!cands.length) return { ok: false, message: `I couldn’t find an eligible ${op.indoor ? 'indoor ' : ''}replacement for "${name}" that fits your equipment, so I left it alone.`, changed: [], draft }
  const changed: string[] = []
  let used: string | null = null
  for (const s of out.sessions) {
    if (!s.blocks.some(b => b.drills.some(d => d.name === name))) continue
    // One replacement per session that is not already doing the same drill.
    const inSession = new Set(s.blocks.flatMap(b => b.drills.map(d => d.drillId)))
    const pick = cands.find(c => !inSession.has(c.drill.id))
    if (!pick) continue
    used = pick.drill.drill_name
    for (const b of s.blocks) b.drills = b.drills.map(d => d.name === name ? rowFromDrill(pick, d.skill, d.minutes, 'controlled') : d)
    changed.push(s.key); s.origin = 'coach'
  }
  if (!changed.length) return { ok: false, message: `Every eligible replacement for "${name}" is already in those sessions, so I left it alone.`, changed: [], draft }
  return { ok: true, message: `Replaced "${name}" with "${used}" in ${changed.length} session${changed.length === 1 ? '' : 's'}.`, changed, draft: out }
}

/** After any edit, re-derive what depends on content. */
export function refreshDerived(draft: ProgramDraft): void {
  for (const s of draft.sessions) {
    if (s.kind === 'rest') continue
    // A block is the sum of its drills: an edit to one drill's minutes must
    // flow up, not be "repaired" back down.
    for (const b of s.blocks) if (b.drills.length) b.minutes = b.drills.reduce((a, d) => a + d.minutes, 0)
    s.minutes = s.blocks.reduce((a, b) => a + b.minutes, 0)
    const need = requiredSupervision(s)
    if (need !== 'independent' && s.supervision === 'independent') s.supervision = need
  }
}

export function weekSummary(draft: ProgramDraft, week: number): string {
  const rows = draft.sessions.filter(s => s.week === week).sort((a, b) => a.date.localeCompare(b.date))
  if (!rows.length) return `There is no week ${week} in this program (it has ${draft.brief.weeks}).`
  const day = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(d)]
  const lines = rows.filter(s => s.kind !== 'independent').map(s =>
    s.kind === 'rest' ? `- ${day(s.date)} ${s.date.slice(5)}: rest`
      : `- ${day(s.date)} ${s.date.slice(5)}: ${s.title} (${s.minutes} min${s.checkpoint ? ', ' + s.checkpoint + ' checkpoint' : ''})`)
  return `Week ${week} (${rows[0].date} to ${addDays(rows[0].date, 6)}):\n${lines.join('\n')}`
}
