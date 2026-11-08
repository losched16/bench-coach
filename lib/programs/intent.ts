// What kind of coaching task is this?
//
// A cheap, deterministic classifier that reads the message AND the state of the
// conversation (is there a program draft open?). It exists because the old chat
// had one behaviour — a short conversational answer — and a prompt rule that
// sent anyone asking for a plan somewhere else. Intent decides which pipeline
// runs; it does not decide what the coach is allowed to ask for.
//
// It errs toward 'program' when a coach states a time horizon AND asks for a
// plan, because the failure we are fixing was narrowing, not over-delivering.
// It errs toward 'quick' for everything ambiguous, which is the old behaviour.

import { detectSkills } from './skills'

export type Intent =
  | 'program'          // build a multi-week development program
  | 'program_edit'     // change the open draft or saved program
  | 'team_practice'    // a time-budgeted team practice
  | 'assessment'       // how has the player progressed / what next
  | 'explain'          // teach me how to coach X
  | 'quick'            // short guidance

export interface IntentResult {
  intent: Intent
  /** Why — shown in logs and tests, never trusted as a fact. */
  reasons: string[]
  weeks: number | null
}

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, sixteen: 16,
}

const toNum = (s: string): number | null =>
  /^\d+$/.test(s) ? Number(s) : (NUM[s.toLowerCase()] ?? null)

/** "eight-week", "8 weeks", "three months", "10-wk". Months are 4.33 weeks, rounded. */
export function durationWeeks(text: string): number | null {
  const w = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen)[\s-]*(?:week|wk)s?\b/i.exec(text)
  if (w) { const n = toNum(w[1]); if (n && n >= 1 && n <= 26) return n }
  const m = /\b(\d{1,2}|one|two|three|four|five|six)[\s-]*months?\b/i.exec(text)
  if (m) { const n = toNum(m[1]); if (n) return Math.min(26, Math.round(n * 4.33)) }
  return null
}

const PLAN_WORDS = /\b(program|plan|schedule|regimen|routine|curriculum|roadmap|workouts?|training)\b/i
const BUILD_WORDS = /\b(build|create|make|design|put together|write|give|need|want|generate|draft)\b/i
const EDIT_PATTERNS: RegExp[] = [
  /\b(make|set|change|move|turn)\b.{0,30}\b(mon|tues?|wednes|thurs?|fri|satur|sun)\w*\b.{0,30}\b(rest|off|recovery|day)\b/i,
  /\b(rest|off) day\b/i,
  /\badd (?:more|some|extra)\b/i,
  /\b(?:less|fewer|reduce|cut)\b.{0,25}\b(?:work|time|reps|sessions?|drills?)\b/i,
  /\bchange (?:this|it|the (?:plan|program)) to\b/i,
  /\b(\d|one|two|three|four|five|six)\s*days?\s*(?:a|per)\s*week\b/i,
  /\bshow me (?:week|the week|phase|day)\b/i,
  /\b(?:week|phase)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight)\b/i,
  /\breplace\b.{0,50}\b(?:drill|exercise)\b/i,
  /\b(?:swap|substitute)\b.{0,40}\b(?:drill|exercise|for)\b/i,
  /\b(?:indoors?|inside)\b.{0,30}\b(?:instead|version|alternative|option)\b/i,
  /\bdrop\b.{0,30}\b(?:drill|exercise|session)\b/i,
]

export interface IntentContext {
  /** An editable program draft is open in this conversation. */
  hasOpenDraft?: boolean
  /** Recent user messages, newest last. Used only for follow-up detection. */
  recentUserMessages?: string[]
  /** The conversation is already about one player. */
  hasPlayer?: boolean
}

export function classifyIntent(message: string, ctx: IntentContext = {}): IntentResult {
  const m = message.trim()
  const reasons: string[] = []
  const weeks = durationWeeks(m)

  if (ctx.hasOpenDraft && EDIT_PATTERNS.some(r => r.test(m)) && m.length < 400) {
    reasons.push('edit phrase while a program draft is open')
    return { intent: 'program_edit', reasons, weeks }
  }

  const skills = detectSkills(m)
  const asksForPlan = PLAN_WORDS.test(m) && BUILD_WORDS.test(m)
  const longHorizon = /\b(offseason|off-season|pre-?season|winter workouts?|season[- ]long|tryouts?)\b/i.test(m)
  const daily = /\b(daily|every day|each day|five days|5 days|days a week|per week a week)\b/i.test(m)

  if (weeks && weeks >= 2 && (asksForPlan || skills.length >= 2)) {
    reasons.push(`${weeks}-week horizon with a plan request`)
    return { intent: 'program', reasons, weeks }
  }
  if (asksForPlan && skills.length >= 3) {
    reasons.push(`plan request spanning ${skills.length} skills`)
    return { intent: 'program', reasons, weeks }
  }
  if (asksForPlan && (longHorizon || daily) && skills.length >= 1) {
    reasons.push('plan request tied to an offseason/tryout/daily horizon')
    return { intent: 'program', reasons, weeks }
  }

  if (/\b(practice)\b/i.test(m) && /\b(team|\d+\s?u\b|our|squad|roster|minute)\b/i.test(m) &&
      /\b(build|plan|create|make|run|design|put together)\b/i.test(m) &&
      !/\b(my (?:son|daughter|kid|player)|individual|private|one[- ]on[- ]one)\b/i.test(m)) {
    reasons.push('team practice request')
    return { intent: 'team_practice', reasons, weeks }
  }

  if (/\b(how much (?:has|have|did)|how (?:is|are|has|have)\b.{0,30}\b(?:progress|improv|doing|developing)|progress (?:report|review|so far)|what should we focus on (?:next|this)|where (?:is|are)\b.{0,25}\bnow)\b/i.test(m)) {
    reasons.push('progress review wording')
    return { intent: 'assessment', reasons, weeks }
  }

  if (/\b(teach me|how (?:do|can|should) i (?:teach|coach)|explain (?:how|the)|how to coach|walk me through)\b/i.test(m)) {
    reasons.push('teach/explain wording')
    return { intent: 'explain', reasons, weeks }
  }

  reasons.push('default: short guidance')
  return { intent: 'quick', reasons, weeks }
}
