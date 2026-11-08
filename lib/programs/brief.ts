// Turn a coach's words (plus facts we already hold) into a ProgramBrief.
//
// Nothing is invented. Anything the coach did not say is either left unknown or
// given a stated default that is written into brief.assumptions so the editor
// shows it and the coach can change it. Only genuinely blocking gaps are
// returned as questions.

import { BriefSchema, type ProgramBrief, type SkillKey } from './types'
import { detectSkills, SKILLS } from './skills'
import { durationWeeks } from './intent'

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const NUMW: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7 }

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}
export function parseYmd(s: string): Date { return new Date(`${s}T00:00:00Z`) }
export function addDays(s: string, n: number): string {
  const d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d)
}
/** 0 = Sunday … 6 = Saturday. */
export function weekday(s: string): number { return parseYmd(s).getUTCDay() }
export function nextMonday(from: string): string {
  const wd = weekday(from)
  return addDays(from, wd === 1 ? 7 : (8 - wd) % 7 || 7)
}

interface DateHit { date: string; index: number; text: string }

/** Dates like "November 9, 2026", "Nov 9", "January 8, 2027". Year-less dates roll forward. */
export function findDates(text: string, today: string): DateHit[] {
  const out: DateHit[] = []
  const re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    const day = Number(m[2])
    if (mi < 0 || day < 1 || day > 31) continue
    let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4))
    let d = new Date(Date.UTC(year, mi, day))
    if (!m[3] && ymd(d) < today) d = new Date(Date.UTC(year + 1, mi, day))
    out.push({ date: ymd(d), index: m.index, text: m[0] })
  }
  return out
}

const KNOWN_EQUIPMENT: Array<[RegExp, string]> = [
  [/\b(batting )?tee\b/i, 'batting tee'], [/\bnet\b/i, 'net'], [/\bresistance bands?|\bbands\b/i, 'resistance bands'],
  [/\bdumbbells?\b/i, 'dumbbells'], [/\bmed(?:icine)? balls?\b/i, 'medicine ball'],
  [/\bbatting cage|\bcage\b/i, 'batting cage'], [/\bfield\b/i, 'field'], [/\bcones?\b/i, 'cones'],
  [/\bpitching machine\b/i, 'pitching machine'], [/\bradar|\bblast\b|\bstalker\b/i, 'radar'],
]

export function detectEquipment(text: string): string[] {
  return KNOWN_EQUIPMENT.filter(([r]) => r.test(text)).map(([, n]) => n)
}

export interface BriefInput {
  message: string
  /** Earlier user turns in the same conversation, so a follow-up inherits them. */
  priorUserMessages?: string[]
  playerId: string
  playerName?: string | null
  age: number | null
  positions?: string[]
  skillLevel?: ProgramBrief['skillLevel']
  today: string
  /** Explicit values from the structured form. They override anything parsed. */
  overrides?: Partial<ProgramBrief>
}

export interface BriefResult {
  brief: ProgramBrief | null
  /** Essential gaps only. */
  questions: string[]
}

export function buildBrief(input: BriefInput): BriefResult {
  const text = [...(input.priorUserMessages || []), input.message].join('\n')
  const o = input.overrides || {}
  const assumptions: string[] = [...(o.assumptions || [])]
  const questions: string[] = []

  // ── skills, in the order the coach listed them ───────────────────────────
  let skills: SkillKey[] = o.skills?.length ? [...o.skills] : detectSkills(text)
  // A coach who says "first step AND acceleration" means two goals; pitching
  // implies the readiness gate; strength requests always include the physical
  // block. Nothing is removed here.
  if (skills.length === 0) questions.push('Which skills should this program develop? (for example speed, outfield, hitting, pitching, strength)')

  // ── horizon ──────────────────────────────────────────────────────────────
  let weeks = o.weeks ?? durationWeeks(text)
  if (!weeks) { weeks = 8; assumptions.push('No length was given, so I planned 8 weeks.') }

  const dates = findDates(text, input.today)
  let startDate = o.startDate
  if (!startDate) {
    const begin = dates.find(d => /(begin|start|kick)/i.test(text.slice(Math.max(0, d.index - 40), d.index + d.text.length + 5)))
    startDate = begin?.date
  }
  if (!startDate) {
    startDate = nextMonday(input.today)
    assumptions.push(`No start date was given, so the program starts Monday ${startDate}.`)
  }

  const milestones: ProgramBrief['milestones'] = [...(o.milestones || [])]
  for (const d of dates) {
    if (d.date === startDate) continue
    // Only the words just BEFORE the date describe it; wider windows bleed one
    // milestone's label onto its neighbour ("winter workouts … January 8,
    // tryouts … March 8").
    const near = text.slice(Math.max(0, d.index - 45), d.index)
    const label = /tryouts?[^.]*$/i.test(near) ? 'Tryouts' : /winter (?:workouts?|training)[^.]*$/i.test(near) ? 'Winter workouts begin'
      : /(?:game|tournament|season opener)[^.]*$/i.test(near) ? 'Competition' : null
    if (label && !milestones.some(x => x.date === d.date)) milestones.push({ label, date: d.date })
  }

  // ── frequency and length ─────────────────────────────────────────────────
  let supervised = o.supervisedDaysPerWeek
  if (!supervised) {
    const m = /\b(one|two|three|four|five|six|\d)\s+(?:supervised\s+|coached\s+)?(?:training\s+)?days?\s*(?:a|per|each)?\s*(?:week)?/i.exec(text)
    const n = m ? (/^\d$/.test(m[1]) ? Number(m[1]) : NUMW[m[1].toLowerCase()]) : null
    if (n && n >= 1 && n <= 6) supervised = n
  }
  if (!supervised) { supervised = 4; assumptions.push('No training frequency was given, so I planned 4 supervised days a week.') }
  supervised = Math.min(6, supervised)

  let sessionMinutes = o.sessionMinutes
  if (!sessionMinutes) {
    const m = /\b(\d{2,3})[\s-]*(?:min(?:ute)?s?)\b/i.exec(text)
    if (m && Number(m[1]) >= 20 && Number(m[1]) <= 120) sessionMinutes = Number(m[1])
  }
  if (!sessionMinutes) { sessionMinutes = 60; assumptions.push('No session length was given, so supervised sessions are 60 minutes.') }

  let independentMinutes = o.independentMinutes
  if (independentMinutes == null) {
    independentMinutes = /independent|on (?:his|her|their) own|daily/i.test(text) ? 10 : 0
    if (independentMinutes) assumptions.push('Independent routines are about 10 minutes.')
  }

  // ── equipment ────────────────────────────────────────────────────────────
  const equipment = o.equipment?.length ? o.equipment : detectEquipment(text)
  if (equipment.length === 0) assumptions.push('No equipment list was given, so only bodyweight and basic gear (ball, glove, bat) are assumed.')

  const outdoorAccess = o.outdoorAccess ?? (/\boutdoor|field\b/i.test(text) ? true : null)
  const indoorAccess = o.indoorAccess ?? (/\bindoor|cage|gym|garage|basement\b/i.test(text) ? true : null)

  // ── arm status ───────────────────────────────────────────────────────────
  const resting = /\b(resting|rested|rest(?:ing)? (?:his|her|their)? ?arm|off throwing|shut down|not thrown)\b/i.test(text)
  const pain = /\b(pain|hurt|sore|injur|tender|strain)\b/i.test(text)
  const throwing: ProgramBrief['throwing'] = o.throwing ?? {
    status: resting ? 'resting' : 'unknown',
    restDetails: null,
    painHistory: pain ? 'reported' : 'unknown',
  }
  if (skills.includes('pitching_readiness') && throwing.status !== 'active') {
    assumptions.push('The throwing gate starts closed: the rest length and any pain history were not provided.')
  }

  // ── concerns (the coach's own words) ─────────────────────────────────────
  const concerns: ProgramBrief['concerns'] = [...(o.concerns || [])]
  if (!concerns.length) {
    for (const sentence of text.split(/(?:[.!?\n]|;\s)/)) {
      const s = sentence.trim()
      // A goal is not a concern: "I want to improve…" states what to build.
      if (/^(?:please\s+)?(?:build|create|make|design|i want|we want|i need|we need|i'd like|we'd like)\b/i.test(s)) continue
      if (s.length < 8 || !/\b(slow|struggl|trouble|difficult|weak|anxious|worr|can'?t|doesn'?t|pull(?:ing)? off|open(?:s|ing)? (?:early|hips)|drift)/i.test(s)) continue
      const sk = detectSkills(s)[0]
      if (sk) concerns.push({ skill: sk, text: s.slice(0, 300) })
    }
  }

  // A one-skill request ("a power-hitting plan") usually arrives as a short
  // wish, not a complaint. Keep the coach's own words with the skill so they
  // show in the editor and reach the coaching text.
  if (skills.length === 1 && input.message.trim() && concerns.length === 0) {
    concerns.push({ skill: skills[0], text: input.message.trim().slice(0, 300) })
  }

  const parsed = BriefSchema.safeParse({
    playerId: input.playerId,
    playerName: input.playerName ?? null,
    age: input.age,
    positions: input.positions || [],
    skillLevel: input.skillLevel ?? o.skillLevel ?? null,
    skills, concerns, startDate, weeks,
    supervisedDaysPerWeek: supervised, sessionMinutes, independentMinutes,
    equipment, indoorAccess, outdoorAccess, milestones, throwing,
    filming: o.filming ?? /\b(film|filming|youtube|channel|record(?:ed|ing)? (?:the )?session)\b/i.test(text),
    assumptions,
  })
  if (!parsed.success) {
    if (questions.length === 0) questions.push('I could not read all of that — could you restate the length, start date and skills?')
    return { brief: null, questions }
  }
  if (input.age == null) assumptions.push('The player’s age is not on file, so age-based drill filtering is off.')
  return { brief: questions.length ? null : { ...parsed.data, assumptions }, questions }
}

export { SKILLS }
