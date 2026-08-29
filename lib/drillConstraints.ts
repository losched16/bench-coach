// What the coach told us about their situation, read out of their own words.
//
// A coach who types "we're stuck in the gym tonight" has said something the
// retrieval layer can act on: indoor_outdoor is populated on every drill in
// production and until now nothing looked at it. Same for "just me and him in
// the backyard" — that is a space constraint and a partner constraint in one
// sentence.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: absence is not a constraint.
//
// Every field here comes back undefined unless the coach said something that
// clearly implies it. A question that never mentions equipment does not mean
// the coach has none, and turning silence into a filter would quietly empty
// the library — which is a much worse failure than not filtering, because it
// looks like the library is small rather than like the filter is wrong.
//
// Deliberately regex rather than a model call. This runs on every chat message
// before the answer starts, it needs to be free and instant, and the cost of a
// miss is one unapplied filter rather than a wrong one. Anything genuinely
// ambiguous is left alone.

import { RetrievalConstraints } from '@/lib/drillRetrieval'

/** Phrases that place the coach indoors. */
const INDOOR = /\b(indoor|inside|in the (gym|garage|basement|house|cage)|gym|garage|basement|rain(ing|ed| out)?|snow|bad weather|winter|off.?season)\b/i
const OUTDOOR = /\b(outdoor|outside|on the field|at the (field|park|diamond)|infield|outfield)\b/i

/** Small enough that a drill needing a field is out. */
const SMALL_SPACE = /\b(backyard|back yard|garage|basement|living room|driveway|hallway|small space|limited space|not much (room|space)|tight space|indoors? at home)\b/i
const BIG_SPACE = /\b(full field|whole field|outfield|open field|big space|lots of (room|space))\b/i

/** One adult, or one adult and one kid. */
const ALONE = /\b(by myself|on my own|just me|alone|no partner|solo|no one to (help|throw)|nobody to (help|throw)|single parent|one coach)\b/i

/**
 * Equipment a coach might name. Matched loosely because they will not use the
 * library's spelling — "batting tee" for "Tee", "wiffle balls" for "Wiffle".
 *
 * Only consulted when the sentence looks like an inventory ("we have…", "all
 * we've got is…", "with a…"), so that mentioning a bat in passing does not
 * become a claim that a bat is the only thing they own.
 */
const HAS_PHRASE = /\b(we (have|only have|"?ve got)|i (have|only have|"?ve got)|all (we|i) (have|"?ve got)|with (just |only )?(a|an|some|our)|using (just |only )?(a|an|some|our)|access to)\b/i
const EQUIPMENT_TERMS = [
  'tee', 'baseballs', 'balls', 'wiffle', 'bat', 'bats', 'glove', 'gloves',
  'cones', 'net', 'screen', 'bucket', 'tennis balls', 'towel', 'pvc',
  'rope', 'ladder', 'weighted balls', 'radar', 'helmet', 'catcher',
]

/**
 * Read constraints out of a coach's message.
 *
 * Returns only the keys it is confident about. Everything else is absent, and
 * `retrieveDrills` treats absent as unknown.
 */
export function constraintsFromText(text: string): Partial<RetrievalConstraints> {
  const t = String(text || '')
  if (!t.trim()) return {}
  const out: Partial<RetrievalConstraints> = {}

  // ── where ───────────────────────────────────────────────────────────────
  // Outdoor wins a tie: "we practise outside but it's raining" is a coach
  // describing the normal case and an exception, and the exception is the one
  // they are asking about — so indoor is checked second and overrides.
  if (OUTDOOR.test(t)) out.indoorOutdoor = 'outdoor'
  if (INDOOR.test(t)) out.indoorOutdoor = 'indoor'

  // ── how much room ───────────────────────────────────────────────────────
  if (SMALL_SPACE.test(t)) out.spaceAvailable = 'small'
  else if (BIG_SPACE.test(t)) out.spaceAvailable = 'large'

  // ── who else is there ───────────────────────────────────────────────────
  if (ALONE.test(t)) out.alone = true

  // ── what they have ──────────────────────────────────────────────────────
  // Gated on an inventory phrase. Without it, a question that happens to say
  // "his bat" would be read as "a bat is all they own" and every drill needing
  // anything else would be filtered out.
  if (HAS_PHRASE.test(t)) {
    const lower = t.toLowerCase()
    const found = EQUIPMENT_TERMS.filter(term => new RegExp(`\\b${term}\\b`).test(lower))
    if (found.length > 0) out.availableEquipment = found
  }

  return out
}

/**
 * Age written in the question itself — "my 8-year-old", "he's 9".
 *
 * Chat prefers a real birth year from the roster; this covers the common case
 * where a coach asks about a kid who is not in the app, or is not the player
 * the thread is scoped to.
 */
export function ageFromText(text: string): number | null {
  const t = String(text || '')
  const m =
    t.match(/\b(\d{1,2})[\s-]*(?:year|yr)s?[\s-]*old\b/i) ||
    t.match(/\b(?:he|she|they|kid|son|daughter|player)(?:'s| is)\s+(\d{1,2})\b/i) ||
    t.match(/\b(\d{1,2})u\b/i)
  if (!m) return null
  const n = Number(m[1])
  // Youth baseball. A number outside this is a jersey, a count or a year.
  return n >= 4 && n <= 18 ? n : null
}
