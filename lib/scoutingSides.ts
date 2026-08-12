// Which of these two teams am I scouting?
//
// A GameChanger box score shows BOTH teams. The parser used to be told
// "extract the OPPONENT team's data" and nothing else — not our team name, not
// the opponent's name, not our roster. That question is unanswerable from the
// pixels, so the model either guessed or returned everybody, and a coach ended
// up with their own players saved into an opponent's roster.
//
// That is worse than a cosmetic mess. Opponent rosters drive pitch-count
// availability, and an availability board with our own kids in it is wrong in a
// way that looks authoritative.
//
// The fix is a division of labour. The MODEL separates the two teams, which is
// just reading what is on the screen. THIS FILE decides which side is the
// opponent, using the three things the app knows and the model never did:
//
//   1. the opponent name the coach already typed or selected
//   2. our own team name
//   3. our own roster
//
// And when none of those settle it, it says so, and the coach taps a button.
// Guessing silently is what caused the problem in the first place.

export interface ParsedSide {
  team_name: string | null
  /** 'home' | 'away' | null — as printed, not inferred. */
  side?: string | null
  players: any[]
}

export interface SideChoice {
  /** The side to scout, or null when there is nothing usable. */
  opponent: ParsedSide | null
  /** The side we believe is the coach's own team, when we identified one. */
  ours: ParsedSide | null
  /** Plain English, shown to the coach so the decision is never invisible. */
  reason: string
  /** False means: ask. Do not save on a guess. */
  confident: boolean
}

// ---------------------------------------------------------------------------
// Name comparison
// ---------------------------------------------------------------------------

/** Lowercase, no punctuation, no double spaces. */
export function normalizeName(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Words that carry no identity. "Yankees 10U Blue" and "Yankees Blue" are the
// same team, and matching on "10u" would happily pair two unrelated teams.
const NOISE = new Set([
  '10u', '12u', '14u', '8u', '6u', '16u', '18u',
  'baseball', 'club', 'travel', 'select', 'academy', 'team', 'the',
  'red', 'blue', 'black', 'white', 'gold', 'silver', 'green', 'orange', 'navy',
])

function meaningfulWords(s: string): string[] {
  return normalizeName(s).split(' ').filter(w => w && !NOISE.has(w))
}

/**
 * 0 to 1, on the words that actually name a team.
 *
 * Deliberately not a character-level distance: "Rangers" and "Raiders" are
 * close by edit distance and are different clubs, while "Springfield Rangers"
 * and "Rangers 10U Red" are far apart and are the same one.
 */
export function teamNameSimilarity(a: string, b: string): number {
  const wa = meaningfulWords(a)
  const wb = meaningfulWords(b)
  if (wa.length === 0 || wb.length === 0) return 0
  const setB = new Set(wb)
  const shared = wa.filter(w => setB.has(w)).length
  return shared / Math.min(wa.length, wb.length)
}

const STRONG_TEAM_MATCH = 0.6

/**
 * Does this player name refer to the same kid as that one?
 *
 * Box scores abbreviate inconsistently — "T. Smith", "Tommy Smith", "Smith, T"
 * — so this matches on surname plus first initial, which is what a human does
 * when reading two versions of the same lineup card.
 */
export function samePlayer(a: string, b: string): boolean {
  const pa = playerKey(a)
  const pb = playerKey(b)
  if (!pa || !pb) return false
  if (pa.last !== pb.last) return false
  // A surname alone matches a surname alone; two known initials must agree.
  if (!pa.initial || !pb.initial) return true
  return pa.initial === pb.initial
}

function playerKey(raw: string): { last: string; initial: string } | null {
  let s = normalizeName(raw)
  if (!s) return null
  // "smith t" (from "Smith, T.") reads the same as "t smith".
  const parts = s.split(' ').filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return { last: parts[0], initial: '' }
  // Whichever end is the single letter is the initial.
  if (parts[0].length === 1) return { last: parts[parts.length - 1], initial: parts[0] }
  if (parts[parts.length - 1].length === 1) return { last: parts[0], initial: parts[parts.length - 1] }
  return { last: parts[parts.length - 1], initial: parts[0][0] }
}

/** How much of this side is made up of players on the given roster, 0 to 1. */
export function rosterOverlap(side: ParsedSide, roster: string[]): number {
  const names = (side.players || []).map(p => p?.name).filter(Boolean)
  if (names.length === 0 || roster.length === 0) return 0
  const hits = names.filter(n => roster.some(r => samePlayer(n, r))).length
  return hits / names.length
}

// Two players could coincide across unrelated teams — surnames repeat. Half a
// lineup does not.
const OURS_OVERLAP = 0.4
const OURS_MIN_HITS = 2

function overlapHits(side: ParsedSide, roster: string[]): number {
  const names = (side.players || []).map(p => p?.name).filter(Boolean)
  return names.filter(n => roster.some(r => samePlayer(n, r))).length
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface SideContext {
  /** The opponent the coach selected or typed, if any. */
  opponentName?: string | null
  /** The coach's own team name. */
  ourTeamName?: string | null
  /** The coach's own player names. The strongest signal when names are vague. */
  ourRoster?: string[]
}

/**
 * Pick the side to scout.
 *
 * Signals are tried strongest first, and each one that fires is reported in
 * `reason` so the coach can see WHY a team was chosen and correct it in one
 * tap if the app got it wrong.
 */
export function chooseOpponentSide(
  sides: ParsedSide[],
  ctx: SideContext = {}
): SideChoice {
  const usable = (sides || []).filter(s => s && Array.isArray(s.players))
  const roster = (ctx.ourRoster || []).filter(Boolean)

  if (usable.length === 0) {
    return { opponent: null, ours: null, reason: 'No teams could be read from that image.', confident: false }
  }

  // Only one team on the page. Common when a coach screenshots half a box
  // score, and it is still ambiguous — it might be OUR half.
  if (usable.length === 1) {
    const only = usable[0]
    const looksOurs =
      (ctx.ourTeamName && teamNameSimilarity(only.team_name || '', ctx.ourTeamName) >= STRONG_TEAM_MATCH) ||
      (overlapHits(only, roster) >= OURS_MIN_HITS && rosterOverlap(only, roster) >= OURS_OVERLAP)
    if (looksOurs) {
      return {
        opponent: null, ours: only, confident: false,
        reason: `That looks like your own team${only.team_name ? ` (${only.team_name})` : ''}, not an opponent. Check the screenshot.`,
      }
    }
    return {
      opponent: only, ours: null, confident: true,
      reason: only.team_name
        ? `Only one team in the image: ${only.team_name}.`
        : 'Only one team in the image.',
    }
  }

  // 1. The coach already told us who they are scouting. Believe them.
  if (ctx.opponentName) {
    const scored = usable
      .map(s => ({ s, sim: teamNameSimilarity(s.team_name || '', ctx.opponentName!) }))
      .sort((a, b) => b.sim - a.sim)
    if (scored[0].sim >= STRONG_TEAM_MATCH && scored[0].sim > scored[1].sim) {
      return {
        opponent: scored[0].s,
        ours: scored[1].s,
        confident: true,
        reason: `Matched "${scored[0].s.team_name}" to the opponent you picked.`,
      }
    }
  }

  // 2. Our own name is on one of them, so the opponent is the other one.
  if (ctx.ourTeamName) {
    const scored = usable
      .map(s => ({ s, sim: teamNameSimilarity(s.team_name || '', ctx.ourTeamName!) }))
      .sort((a, b) => b.sim - a.sim)
    if (scored[0].sim >= STRONG_TEAM_MATCH && scored[0].sim > scored[1].sim) {
      return {
        opponent: scored[1].s,
        ours: scored[0].s,
        confident: true,
        reason: `"${scored[0].s.team_name}" is your team, so we took the other side.`,
      }
    }
  }

  // 3. Our players are on one of them. This is the signal that survives missing
  //    or abbreviated team names, which is most of the hard cases.
  if (roster.length > 0) {
    const scored = usable
      .map(s => ({ s, hits: overlapHits(s, roster), frac: rosterOverlap(s, roster) }))
      .sort((a, b) => b.frac - a.frac)
    const top = scored[0]
    if (top.hits >= OURS_MIN_HITS && top.frac >= OURS_OVERLAP && top.frac > scored[1].frac) {
      const other = scored[1].s
      return {
        opponent: other,
        ours: top.s,
        confident: true,
        reason: `${top.hits} of those players are on your roster, so that side is yours — we took ${other.team_name || 'the other team'}.`,
      }
    }
  }

  // Nothing settled it. Say so rather than picking one and hoping: a wrong
  // roster is expensive to unpick and this is one tap to avoid.
  const guess = usable.reduce((a, b) => (b.players.length > a.players.length ? b : a))
  return {
    opponent: guess,
    ours: usable.find(s => s !== guess) || null,
    confident: false,
    reason: 'Both teams are in this image and we cannot tell which one you are scouting.',
  }
}

/**
 * Players on this list who are also on the coach's own roster.
 *
 * The last line of defence, run on whatever the coach is about to save. Even
 * with the right side chosen, one stray row is enough to poison an availability
 * board — and the coach can see the name and decide, which the model cannot.
 */
export function ownPlayersIn(players: any[], roster: string[]): string[] {
  if (!roster?.length) return []
  return (players || [])
    .map(p => p?.name)
    .filter((n: string) => n && roster.some(r => samePlayer(n, r)))
}
