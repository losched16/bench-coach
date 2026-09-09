// Reading a practice out of the way a coach describes it.
//
// The generator has always taken free text — `constraints` goes into both the
// retrieval query and the prompt — but the numbers beside it did not. Duration
// and focus areas came from dropdowns, so a coach who had already written
//
//   "Can you create a practice plan for 4 coaches, 2 hours. Starting with
//    throwing progressions, then I want hitting stations to help with proper
//    load fundamentals. Then I want stations for proper ground ball
//    fundamentals as well."
//
// had to translate their own sentence into a duration, three checkboxes and a
// coach count before the app would read the sentence. This does the
// translation instead.
//
// WHAT IT WILL AND WILL NOT DO
//
// It reads what was stated and leaves everything else null. A null is not a
// failure — the caller keeps whatever the coach already had selected, which is
// why nothing here guesses. Reading "9u" as a 9-minute practice, or inventing
// a coach count from "we", would silently produce a plan built for a session
// that was never described.
//
// The order focus areas come back in is the order they appear in the text.
// "Starting with throwing progressions, then hitting" is a sequence, and the
// coach said it on purpose.

import { FocusArea, isFocusArea } from './focusAreas'

export interface PromptInputs {
  /** Minutes, when stated. */
  duration: number | null
  /** Focus areas, in the order the coach named them. */
  focus: FocusArea[]
  /** Adults at this session, when stated. */
  coachCount: number | null
  /** Players expected, when stated. */
  playerCount: number | null
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
}

function num(raw: string | undefined): number | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (WORD_NUMBERS[s] != null) return WORD_NUMBERS[s]
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety)'

/**
 * How long the practice is, in minutes.
 *
 * Deliberately does not accept a bare "h" as an hour unit. "9u" and "12u" are
 * how every youth team in the product is written, and a looser pattern reads
 * an age group as a duration — which is the kind of wrong that produces a
 * nine-minute practice and looks like the app is broken.
 */
export function durationFromPrompt(text: string | null | undefined): number | null {
  const s = String(text || '')

  // "an hour and a half", "hour and a half", "1.5 hours"
  if (/\b(an?\s+)?hour\s+and\s+a\s+half\b/i.test(s)) return 90

  const hours = new RegExp(`\\b${NUM}\\s*(?:hours?|hrs?)\\b`, 'i').exec(s)
  if (hours) {
    const n = num(hours[1])
    if (n != null && n > 0 && n <= 6) return Math.round(n * 60)
  }

  const mins = new RegExp(`\\b${NUM}\\s*(?:minutes?|mins?)\\b`, 'i').exec(s)
  if (mins) {
    const n = num(mins[1])
    if (n != null && n >= 15 && n <= 360) return Math.round(n)
  }

  // A bare "an hour" with no number in front of it.
  if (/\ban?\s+hour\b/i.test(s)) return 60

  return null
}

/** Adults at this session, when the coach said. */
export function coachCountFromPrompt(text: string | null | undefined): number | null {
  const s = String(text || '')

  // "just me", "on my own", "by myself", "solo", "no help"
  if (/\b(just me|by myself|on my own|alone|solo|no help|only coach)\b/i.test(s)) return 1

  const m = new RegExp(`\\b${NUM}\\s*(?:coach(?:es)?|adults?|dads?|parents? helping|helpers?)\\b`, 'i').exec(s)
  const n = num(m?.[1])
  // Above about six the number stops changing any decision, and the route
  // treats anything outside 1-6 as unknown. Match it rather than sending a
  // value that will be discarded without saying so.
  return n != null && n >= 1 && n <= 6 ? Math.round(n) : null
}

/** Players expected, when the coach said. */
export function playerCountFromPrompt(text: string | null | undefined): number | null {
  const s = String(text || '')
  const m = new RegExp(`\\b${NUM}\\s*(?:players?|kids?|boys?|girls?|athletes?)\\b`, 'i').exec(s)
  const n = num(m?.[1])
  return n != null && n >= 1 && n <= 30 ? Math.round(n) : null
}

// Ordered most-specific first, same reasoning as focusAreas.KEYWORD_TO_AREA:
// "outfield" must not be swallowed by "field". This is a separate list because
// that one answers "which ONE area is this about" for a diagnosis, and a
// practice prompt names several on purpose.
const AREA_PATTERNS: Array<[RegExp, FocusArea]> = [
  [/\b(catchers?|catching|block(ing)?|receiving|pop time)\b/i, 'catching'],
  [/\b(pitchers?|pitching|mound|velo(city)?|bullpens?|changeups?|curve|arm care)\b/i, 'pitching'],
  [/\b(hits?|hitting|swings?|bats?|batting|tees?|bunts?|bunting|soft toss|front toss|contact|at.?bats?)\b/i, 'hitting'],
  // Plurals matter here more than anywhere else in this file: "ground balls"
  // is how the phrase is normally written, and `ground ?ball\b` does not match
  // it — there is no word boundary between "ball" and "s". A test caught this;
  // the singular in the prompt that prompted all of this happened to pass.
  [/\b(outfield|infield|ground ?balls?|fly ?balls?|glove work|field(ing)?|defen[cs]e|double plays?)\b/i, 'fielding'],
  [/\b(throws?|throwing|arm action|long toss|transfers?|arm slot|arm path|crow hops?)\b/i, 'throwing'],
  [/\b(baserun|base ?running|steal(ing)?|lead ?off|round(ing)? (the )?bag|sliding)\b/i, 'baserunning'],
  [/\b(agility|speed work|quickness|mobility|conditioning|athletic|footwork|sprint)\b/i, 'athleticism'],
]

/**
 * Every focus area the text names, in the order it names them.
 *
 * Order is the point. "Starting with throwing progressions, then hitting
 * stations, then ground balls" describes a shape for the session, and a set
 * sorted alphabetically throws that away before the generator sees it.
 */
export function focusAreasFromPrompt(text: string | null | undefined): FocusArea[] {
  const s = String(text || '')
  if (!s.trim()) return []

  const firstSeen: Array<{ area: FocusArea; at: number }> = []
  for (const [pattern, area] of AREA_PATTERNS) {
    const re = new RegExp(pattern.source, 'gi')
    const m = re.exec(s)
    if (m && !firstSeen.some(f => f.area === area)) {
      firstSeen.push({ area, at: m.index })
    }
  }
  return firstSeen.sort((a, b) => a.at - b.at).map(f => f.area)
}

/**
 * Everything readable out of one description, with nulls where it said nothing.
 *
 * The caller decides what to do with a null — normally "keep what is already
 * selected". Nothing here substitutes a default, because a default that
 * arrives silently is indistinguishable from something the coach asked for.
 */
export function practiceInputsFromPrompt(text: string | null | undefined): PromptInputs {
  return {
    duration: durationFromPrompt(text),
    focus: focusAreasFromPrompt(text),
    coachCount: coachCountFromPrompt(text),
    playerCount: playerCountFromPrompt(text),
  }
}

/** Does this text describe a practice well enough to be worth generating from? */
export function isUsablePracticePrompt(text: string | null | undefined): boolean {
  const s = String(text || '').trim()
  if (s.length < 15) return false
  const i = practiceInputsFromPrompt(s)
  return i.focus.length > 0 || i.duration != null
}

/**
 * The same reading, in the practice form's own vocabulary.
 *
 * That form does not offer the focus-area list this file returns: it splits
 * fielding into "infield" and "outfield", has no "pitching" or "athleticism",
 * and adds "game IQ". Mapping here rather than at the call site keeps the
 * translation in one place and testable — and it can use the TEXT to make the
 * split, which a caller holding only a FocusArea cannot: "ground balls" is
 * infield and "fly balls" is outfield, and guessing between them is the
 * difference between a plan for the dirt and a plan for the grass.
 *
 * Anything with no equivalent on the form is dropped rather than approximated.
 * A silently-substituted focus area is a plan built for something the coach
 * did not ask for.
 */
export function practiceFocusFromPrompt(text: string | null | undefined): string[] {
  const s = String(text || '')
  const out: string[] = []

  for (const area of focusAreasFromPrompt(s)) {
    if (area === 'fielding') {
      const infield = /\b(infield|ground ?balls?|double plays?|short ?stop|second base|third base)\b/i.test(s)
      const outfield = /\b(outfield|fly ?balls?|shag|pop ?ups?)\b/i.test(s)
      if (infield) out.push('infield')
      if (outfield) out.push('outfield')
      // "defense", "glove work" — real but unsplit. Infield is where a youth
      // practice spends the time, and the constraints text still carries the
      // coach's actual words to the model.
      if (!infield && !outfield) out.push('infield')
    } else if (area === 'pitching') {
      // No pitching option on this form; throwing is the honest neighbour.
      out.push('throwing')
    } else if (area === 'athleticism') {
      // No equivalent. Dropped rather than mapped onto something it is not.
      continue
    } else {
      out.push(area)
    }
  }

  // Named directly, with no focus-area equivalent to route through.
  if (/\b(situational|cut ?offs?|relays?|game ?iq|first and third|rundowns?)\b/i.test(s)) {
    out.push('game IQ')
  }

  return Array.from(new Set(out))
}
