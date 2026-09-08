// The box score and the write-up disagree. Say so before the coach saves.
//
// WHY THIS EXISTS
//
// A GameChanger upload carries two independent accounts of the same game: the
// stat table in the screenshots, and the prose recap. The parser reads the
// table. Nothing ever read the prose, even though it arrives in the same
// payload and is stored beside the numbers in raw_parse.
//
// That cost real accuracy. In a logged 8U game the recap said:
//
//   "Teddy H, Rodrick G, Greyson, Charlie L, Lucas, and Wes B each collected
//    one hit for SpringFord 8U Blue."
//
// Six players. The parsed table credited four. Two hits vanished, and one of
// those players then read 0-for-8 for the season on the page his coach plans
// line-ups from. The sentence proving it was sitting in the same record the
// whole time.
//
// WHAT THIS IS AND IS NOT
//
// It is a DISAGREEMENT DETECTOR, not a second parser. It never edits a number
// and never decides which source is right — a recap can be wrong too, and a
// player can be left out of a sentence that lists five of six. It says "these
// two accounts do not match, look at this one", and a person decides.
//
// Precision matters more than recall here. A warning that cries wolf gets
// dismissed reflexively, and then the one that mattered gets dismissed with it.
// So every rule below refuses when the answer is not clear: an ambiguous name,
// an unmatched name, a sentence it cannot parse — all produce silence rather
// than a guess.

import { nameSimilarity } from '@/lib/scouting'

/** A claim the recap makes about one player's hits. */
export interface HitClaim {
  /** The name as the recap wrote it — "Charlie L", "Greyson". */
  who: string
  /** The recap supports AT LEAST this many hits. */
  atLeast: number
  /** The sentence it came from, so a person can check the claim. */
  because: string
  /** The team the sentence credits, when it names one. */
  forTeam?: string | null
}

export interface Discrepancy {
  /** The parsed player this claim was matched to. */
  playerName: string
  /** What the recap said, and what the table recorded. */
  recapSays: number
  parsedHas: number
  who: string
  because: string
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
}

/** "three" or "3" to a number; anything else to null. */
function count(word: string): number | null {
  const w = word.trim().toLowerCase()
  if (WORD_NUMBERS[w] != null) return WORD_NUMBERS[w]
  const n = Number(w)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * The initials a name reduces to, for matching prose against a box score.
 *
 * The two sources write names in opposite shapes: a recap says "Charlie L" and
 * the table says "C Losch". Both reduce to C+L, which is the only thing they
 * reliably share. A single token ("Greyson") gives a first initial and no last,
 * which callers must treat as weaker evidence.
 */
export function initialsOf(name: string): { first: string; last: string | null } | null {
  const cleaned = String(name || '')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, ' ')
    .replace(/[^A-Za-z\s.]/g, ' ')
    .trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  const first = parts[0][0]?.toUpperCase()
  if (!first) return null
  const last = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() ?? null : null
  return { first, last }
}

/**
 * Match one recap name to exactly one parsed player, or to nothing.
 *
 * Returns null on ambiguity as firmly as on absence. Two players who reduce to
 * the same initials cannot be told apart from prose, and picking either would
 * put a warning on an innocent player's line — which is worse than staying
 * quiet, because the coach then has to disprove it.
 */
export function matchRecapName(who: string, parsedNames: string[]): string | null {
  const target = initialsOf(who)
  if (!target) return null

  const hits = parsedNames.filter(n => {
    const p = initialsOf(n)
    if (!p || p.first !== target.first) return false
    // A recap that gave a last initial must agree with the table's surname.
    if (target.last) return p.last === target.last
    // A bare first name matches on the first initial alone, which is only
    // usable when nobody else on the sheet shares it.
    return true
  })

  return hits.length === 1 ? hits[0] : null
}

/**
 * The team a sentence credits its hits to, when it names one.
 *
 * A recap narrates BOTH line-ups, and a hit sentence usually says whose it is:
 * "Luciano and Khaleb each collected three hits for Latin America 8U". Without
 * reading that clause, a claim about the other dugout gets matched against the
 * roster in front of us — which is how a real scan put a Latin America player's
 * three hits on Lucas Ruiz of Springford, the only L on the sheet.
 *
 * Stops at the first lowercase word, so "for Latin America 8U in two at bats"
 * yields the team and not the rest of the sentence.
 */
export function teamCreditedBy(sentence: string): string | null {
  const m = /\bfor\s+([A-Z][\w'\u2019.-]*(?:\s+[A-Z0-9][\w'\u2019.-]*){0,4})/.exec(String(sentence || ''))
  if (!m) return null
  const name = m[1].replace(/[.,;:]+$/, '').trim()
  return name || null
}

/**
 * Every hit the recap prose can be read as claiming.
 *
 * Four sentence shapes, all taken from real GameChanger output, and all read as
 * "at least N" rather than "exactly N". At-least is the honest reading: a recap
 * highlights, it does not tabulate, so it can under-report a player and never
 * over-reports one. That asymmetry is what makes the check safe to act on — a
 * flag means the table is missing something, never that it invented something.
 */
export function hitClaimsFromRecap(text: string): HitClaim[] {
  const src = String(text || '')
  if (!src.trim()) return []
  const claims: HitClaim[] = []
  const add = (who: string, atLeast: number, because: string) => {
    const name = who.trim().replace(/\s+/g, ' ')
    if (name && atLeast > 0) {
      claims.push({
        who: name, atLeast, because: because.trim(), forTeam: teamCreditedBy(because),
      })
    }
  }

  // "A, B, and C each collected one hit" — the sentence that started this.
  const eachRe = /([^.]*?)\beach collected (\w+) hits?\b([^.]*)\./gi
  let m: RegExpExecArray | null
  while ((m = eachRe.exec(src)) !== null) {
    const n = count(m[2])
    if (n == null) continue
    for (const name of m[1].split(/,|\band\b/)) add(name, n, m[0])
  }

  // "Teddy H collected three hits in three at bats"
  const collectedRe = /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?)\s+collected (\w+) hits?\b([^.]*)\./g
  while ((m = collectedRe.exec(src)) !== null) {
    if (/each collected/i.test(m[0])) continue   // handled above
    const n = count(m[2])
    if (n != null) add(m[1], n, m[0])
  }

  // "The first baseman went 1-for-3 on the day" — the number before the dash.
  const wentRe = /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?)\s+went (\d+)-for-(\d+)/g
  while ((m = wentRe.exec(src)) !== null) {
    const n = count(m[2])
    if (n != null) add(m[1], n, m[0])
  }

  // "Rodrick G singled, scoring one run" — one named hit, so at least one.
  // Deliberately not counted per occurrence: the same player is often described
  // twice for the same at-bat, and over-counting would produce false alarms.
  const verbRe = /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?)\s+(singled|doubled|tripled|homered)\b([^.]*)\./g
  while ((m = verbRe.exec(src)) !== null) add(m[1], 1, m[0])

  // Collapse to the strongest claim per name — "went 3-for-3" beats "singled".
  const strongest = new Map<string, HitClaim>()
  for (const c of claims) {
    const key = c.who.toLowerCase()
    const prev = strongest.get(key)
    if (!prev || c.atLeast > prev.atLeast) strongest.set(key, c)
  }
  return Array.from(strongest.values())
}

/**
 * How close two team names must be to be the same team.
 *
 * Low, because the two sources spell it differently on purpose: the tracked
 * record says "Springford Blue" and GameChanger writes "SpringFord 8U Blue".
 * The job here is only to tell one dugout from the other, and the names it
 * must separate — "Springford Blue" from "Latin America 8U" — are nothing
 * alike. Set tighter and the real Springford sentence stops being read.
 */
const SAME_TEAM = 0.6

/**
 * Where the table and the write-up disagree about hits.
 *
 * Only under-reporting is flagged. A table crediting MORE hits than the prose
 * mentions is the normal case — a recap names the highlights and skips the
 * rest — so treating that as an error would flag almost every upload.
 *
 * Pass `subjectTeam` — the team whose players these are. A recap narrates both
 * line-ups, so without it a sentence about the other dugout gets matched
 * against the roster in front of us. That is not hypothetical: run over the
 * stored entries, the check credited a Latin America player's three hits to
 * Lucas Ruiz of Springford, because he was the only L on the sheet. A sentence
 * that names a team is only about that team.
 */
export function crossCheckHits(
  recapText: string,
  players: Array<{ name: string; batting_line?: any }>,
  subjectTeam?: string | null
): Discrepancy[] {
  const claims = hitClaimsFromRecap(recapText)
  if (claims.length === 0) return []

  const names = players.map(p => p.name).filter(Boolean)
  const subject = String(subjectTeam || '').trim()
  const out: Discrepancy[] = []

  for (const claim of claims) {
    // A sentence crediting a team that is not this one is about the other
    // dugout. Skipped rather than guessed at: these rosters are children, and
    // a warning on the wrong one costs the coach the work of disproving it.
    if (subject && claim.forTeam && nameSimilarity(claim.forTeam, subject) < SAME_TEAM) continue

    const matched = matchRecapName(claim.who, names)
    if (!matched) continue
    const player = players.find(p => p.name === matched)
    const h = Number(player?.batting_line?.h)
    // A player with no batting line at all is a different problem — the entry
    // did not record him batting — and is not this check's business.
    if (!Number.isFinite(h)) continue
    if (h < claim.atLeast) {
      out.push({
        playerName: matched,
        recapSays: claim.atLeast,
        parsedHas: h,
        who: claim.who,
        because: claim.because,
      })
    }
  }
  return out
}
