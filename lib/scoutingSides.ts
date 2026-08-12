// Which team in this box score am I logging?
//
// THE WORD "OPPONENT" WAS THE BUG. A coach building a scouting database is
// tracking teams — often teams they have never played, from games they were
// not in. Calling the selected team "the opponent" implied our team is one of
// the two in the picture, and that assumption ran all the way down: the picker
// leaned on "is my team here?" signals that do not apply when neither side is
// ours. A coach selected Warrington, uploaded Warrington vs Springfield, and
// got Springfield.
//
// So the subject of an upload is the TRACKED TEAM. Our own team may or may not
// be in the image and is only ever a tie-breaker.
//
// A GameChanger box score shows BOTH teams, and the parser used to be handed
// the images and nothing else — no tracked team name, no team of ours, no
// roster. That question is unanswerable from the pixels, so the model guessed.
// Which matters: these rosters drive pitch-count availability, and a board with
// the wrong team in it is wrong in a way that looks authoritative.
//
// Division of labour. The MODEL separates the two teams, which is just reading
// the screen. THIS FILE decides which one the coach meant, in priority order:
//
//   1. the team they selected — if they named it, that IS the answer, and when
//      neither side matches we ASK rather than guess
//   2. our own team name, which excludes that side (only when we are playing)
//   3. our own roster, same idea, and it survives unreadable team names
//
// Guessing silently is what caused this twice. It does not guess any more.

export interface ParsedSide {
  team_name: string | null
  /** 'home' | 'away' | null — as printed, not inferred. */
  side?: string | null
  players: any[]
}

export interface SideChoice {
  /** The side the coach is logging, or null when there is nothing usable. */
  tracked: ParsedSide | null
  /** The side that is the coach's OWN team, when one of them is. Usually null:
   *  most scouting uploads are games the coach was not playing in. */
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
 * Does one of these name the same club as the other, allowing for the way box
 * scores abbreviate? "WAR" and "Warrington" are the same team; a scoreboard
 * that prints three letters is the normal case, not the exception.
 */
export function teamNamesMatch(a: string, b: string): boolean {
  if (teamNameSimilarity(a, b) >= STRONG_TEAM_MATCH) return true
  const wa = meaningfulWords(a)
  const wb = meaningfulWords(b)
  if (wa.length === 0 || wb.length === 0) return false
  // A short token that opens a word on the other side: WAR -> Warrington.
  const abbrev = (short: string[], long: string[]) =>
    short.length === 1 && short[0].length >= 2 && short[0].length <= 4 &&
    long.some(w => w.length > short[0].length && w.startsWith(short[0]))
  return abbrev(wa, wb) || abbrev(wb, wa)
}

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
  /** The team the coach selected or typed — the subject of this upload. */
  trackedTeamName?: string | null
  /** The coach's own team name. Only useful when they were actually playing. */
  ourTeamName?: string | null
  /** The coach's own player names. A tie-breaker, not the main signal. */
  ourRoster?: string[]
}

/**
 * Pick the side to scout.
 *
 * Signals are tried strongest first, and each one that fires is reported in
 * `reason` so the coach can see WHY a team was chosen and correct it in one
 * tap if the app got it wrong.
 */
export function chooseTrackedSide(
  sides: ParsedSide[],
  ctx: SideContext = {}
): SideChoice {
  const usable = (sides || []).filter(s => s && Array.isArray(s.players))
  const roster = (ctx.ourRoster || []).filter(Boolean)
  const tracked = ctx.trackedTeamName?.trim() || ''

  if (usable.length === 0) {
    return { tracked: null, ours: null, reason: 'No teams could be read from that image.', confident: false }
  }

  // 1. THE COACH ALREADY TOLD US. This outranks everything, including our own
  //    roster — they are logging the team they named, and if our players are
  //    somehow on that side then the screenshot is wrong, not the selection.
  if (tracked) {
    const matches = usable.filter(s => teamNamesMatch(s.team_name || '', tracked))
    if (matches.length === 1) {
      const other = usable.find(s => s !== matches[0]) || null
      return {
        tracked: matches[0],
        ours: other && ctx.ourTeamName && teamNamesMatch(other.team_name || '', ctx.ourTeamName)
          ? other : null,
        confident: true,
        reason: `Matched "${matches[0].team_name}" to ${tracked}.`,
      }
    }
    // Named a team and it is not on either side — an abbreviation we could not
    // read, or the wrong screenshot. Both are worth a question, and neither is
    // worth a guess: guessing here is exactly how Warrington became
    // Springfield.
    if (matches.length === 0) {
      const names = usable.map(s => s.team_name).filter(Boolean)
      return {
        tracked: null,
        ours: null,
        confident: false,
        reason: names.length
          ? `You're tracking ${tracked}, but this image reads as ${names.join(' and ')}. Pick which one is ${tracked}.`
          : `You're tracking ${tracked}, but neither team name was readable. Pick which one is ${tracked}.`,
      }
    }
    // Both matched — usually two ways of printing the same club. Ask.
    return {
      tracked: null, ours: null, confident: false,
      reason: `Both teams could be ${tracked}. Pick the right one.`,
    }
  }

  // Only one team on the page, and no name to check it against.
  if (usable.length === 1) {
    const only = usable[0]
    const looksOurs =
      (ctx.ourTeamName && teamNamesMatch(only.team_name || '', ctx.ourTeamName)) ||
      (overlapHits(only, roster) >= OURS_MIN_HITS && rosterOverlap(only, roster) >= OURS_OVERLAP)
    if (looksOurs) {
      return {
        tracked: null, ours: only, confident: false,
        reason: `That looks like your own team${only.team_name ? ` (${only.team_name})` : ''}. Name the team you're tracking, or check the screenshot.`,
      }
    }
    return {
      tracked: only, ours: null, confident: true,
      reason: only.team_name
        ? `Only one team in the image: ${only.team_name}.`
        : 'Only one team in the image.',
    }
  }

  // 2. Our own name is on one side, so the coach means the other one. Only
  //    reachable when they did NOT name a team, which means they are logging a
  //    game they played in.
  if (ctx.ourTeamName) {
    const ours = usable.filter(s => teamNamesMatch(s.team_name || '', ctx.ourTeamName!))
    if (ours.length === 1 && usable.length === 2) {
      const other = usable.find(s => s !== ours[0])!
      return {
        tracked: other,
        ours: ours[0],
        confident: true,
        reason: `"${ours[0].team_name}" is your team, so we took the other side.`,
      }
    }
  }

  // 3. Our players are on one side. Survives unreadable team names.
  if (roster.length > 0 && usable.length === 2) {
    const scored = usable
      .map(s => ({ s, hits: overlapHits(s, roster), frac: rosterOverlap(s, roster) }))
      .sort((a, b) => b.frac - a.frac)
    const top = scored[0]
    if (top.hits >= OURS_MIN_HITS && top.frac >= OURS_OVERLAP && top.frac > scored[1].frac) {
      const other = scored[1].s
      return {
        tracked: other,
        ours: top.s,
        confident: true,
        reason: `${top.hits} of those players are on your roster, so that side is yours — we took ${other.team_name || 'the other team'}.`,
      }
    }
  }

  // Nothing to go on. Ask, and say what we are asking about.
  return {
    tracked: null,
    ours: null,
    confident: false,
    reason: 'Two teams in this image and nothing tells us which one you want. Pick one.',
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
