// The scorebook.
//
// An official scorebook is not a stat sheet. It is an ordered record of what
// happened, from which the stats are derived — and the reason it is kept that
// way is that it has to reconcile. Runs, outs, and runners have to add up, or
// the book is worthless in the argument it exists to settle.
//
// So this stores EVENTS, not totals. Every event carries a snapshot of the
// bases and outs before and after it. That has two consequences worth the
// storage:
//
//   Undo is deleting the last row. A coach who taps the wrong thing between
//   pitches gets it back in one tap, with no replay and no drift.
//
//   The state of the game is the last row's after-snapshot. Nothing has to be
//   recomputed correctly under time pressure, and a bug in this file next
//   month cannot silently rewrite a game played last week.
//
// Pure: no database, no React. The screen and the API both reason from here.

// ── Who is on base ─────────────────────────────────────

export interface Runner {
  // The identity of this TRIP AROUND THE BASES, unique within a game — not the
  // identity of the player.
  //
  // Those have to be different. A kid who singles in a big inning and comes up
  // again before the third out is on second AND at the plate, and if both wore
  // his player id the book would decide there were two runners on the same base
  // and refuse the at-bat. Batting around is routine at 8U, so this is not an
  // edge case.
  id: string
  // Who it actually is: team_player_id for ours, a synthetic key for theirs.
  // Stats are credited here. Null only for a runner recorded before this
  // distinction existed.
  playerId?: string | null
  name: string
  // Reached on an error or a passed ball, so runs they score are unearned
  // against our pitcher. Tracked because the pitching line is one of the two
  // things a scorebook is actually for.
  earned: boolean
}

export interface Bases {
  first: Runner | null
  second: Runner | null
  third: Runner | null
}

export const EMPTY_BASES: Bases = { first: null, second: null, third: null }

export type Half = 'top' | 'bottom'

export interface GameState {
  inning: number
  half: Half
  outs: number
  bases: Bases
  awayRuns: number
  homeRuns: number
}

export const NEW_GAME: GameState = {
  inning: 1, half: 'top', outs: 0, bases: EMPTY_BASES, awayRuns: 0, homeRuns: 0,
}

// ── What can happen ────────────────────────────────────

export type EventKind = 'pa' | 'base'

export type PAResult =
  | '1B' | '2B' | '3B' | 'HR'
  | 'BB' | 'IBB' | 'HBP' | 'CI'
  | 'K' | 'KL'
  | 'GO' | 'FO' | 'LO' | 'PO'
  | 'SF' | 'SAC'
  | 'FC' | 'E' | 'DP' | 'TP'

// Things that move runners without a plate appearance ending. At youth level
// these are most of the game — a scorebook without stolen bases is a fiction.
export type BaseResult = 'SB' | 'CS' | 'PB' | 'WP' | 'PK' | 'BALK' | 'OA'

export interface ResultConfig {
  label: string
  // What the coach reads on the button.
  short: string
  // Grouping on the pad, so the tap is where the thumb expects it.
  group: 'hit' | 'onbase' | 'out' | 'other'
  // Counts as an official at-bat (walks, HBP and sacrifices do not).
  atBat: boolean
  hit: boolean
  // Outs this records, before the coach adjusts.
  outs: number
  // Reached base without the defence retiring them cleanly — the run is
  // unearned if they come around.
  unearned?: boolean
}

export const PA_RESULTS: Record<PAResult, ResultConfig> = {
  '1B':  { label: 'Single',            short: '1B',  group: 'hit',    atBat: true,  hit: true,  outs: 0 },
  '2B':  { label: 'Double',            short: '2B',  group: 'hit',    atBat: true,  hit: true,  outs: 0 },
  '3B':  { label: 'Triple',            short: '3B',  group: 'hit',    atBat: true,  hit: true,  outs: 0 },
  'HR':  { label: 'Home run',          short: 'HR',  group: 'hit',    atBat: true,  hit: true,  outs: 0 },

  'BB':  { label: 'Walk',              short: 'BB',  group: 'onbase', atBat: false, hit: false, outs: 0 },
  'IBB': { label: 'Intentional walk',  short: 'IBB', group: 'onbase', atBat: false, hit: false, outs: 0 },
  'HBP': { label: 'Hit by pitch',      short: 'HBP', group: 'onbase', atBat: false, hit: false, outs: 0 },
  'CI':  { label: 'Catcher interference', short: 'CI', group: 'onbase', atBat: false, hit: false, outs: 0 },
  'E':   { label: 'Reached on error',  short: 'E',   group: 'onbase', atBat: true,  hit: false, outs: 0, unearned: true },
  'FC':  { label: "Fielder's choice",  short: 'FC',  group: 'onbase', atBat: true,  hit: false, outs: 1 },

  'K':   { label: 'Strikeout swinging', short: 'K',  group: 'out',    atBat: true,  hit: false, outs: 1 },
  'KL':  { label: 'Strikeout looking',  short: 'ꓘ',  group: 'out',    atBat: true,  hit: false, outs: 1 },
  'GO':  { label: 'Ground out',        short: 'GO',  group: 'out',    atBat: true,  hit: false, outs: 1 },
  'FO':  { label: 'Fly out',           short: 'FO',  group: 'out',    atBat: true,  hit: false, outs: 1 },
  'LO':  { label: 'Line out',          short: 'LO',  group: 'out',    atBat: true,  hit: false, outs: 1 },
  'PO':  { label: 'Pop out',           short: 'PO',  group: 'out',    atBat: true,  hit: false, outs: 1 },

  'SF':  { label: 'Sacrifice fly',     short: 'SF',  group: 'other',  atBat: false, hit: false, outs: 1 },
  'SAC': { label: 'Sacrifice bunt',    short: 'SAC', group: 'other',  atBat: false, hit: false, outs: 1 },
  'DP':  { label: 'Double play',       short: 'DP',  group: 'other',  atBat: true,  hit: false, outs: 2 },
  'TP':  { label: 'Triple play',       short: 'TP',  group: 'other',  atBat: true,  hit: false, outs: 3 },
}

export const BASE_RESULTS: Record<BaseResult, { label: string; short: string; outs: number; unearned?: boolean }> = {
  'SB':   { label: 'Stolen base',    short: 'SB',   outs: 0 },
  'CS':   { label: 'Caught stealing', short: 'CS',  outs: 1 },
  'PK':   { label: 'Picked off',     short: 'PK',   outs: 1 },
  'PB':   { label: 'Passed ball',    short: 'PB',   outs: 0, unearned: true },
  'WP':   { label: 'Wild pitch',     short: 'WP',   outs: 0 },
  'BALK': { label: 'Balk',           short: 'BK',   outs: 0 },
  'OA':   { label: 'Other advance',  short: 'OA',   outs: 0 },
}

// ── What one pitch was ─────────────────────────────────
// The same taps the pitch counter takes, but they land in a plate appearance
// as well as on the pitcher's total. One record, not two that disagree.

export type PitchKind = 'ball' | 'strike' | 'foul' | 'in_play'

export interface Count { balls: number; strikes: number; pitches: number }

export const NEW_COUNT: Count = { balls: 0, strikes: 0, pitches: 0 }

/**
 * Apply one pitch to the count.
 *
 * A foul with two strikes is still a pitch and still two strikes — getting
 * that wrong is the classic scorekeeping bug, and it shows up as a batter
 * struck out on a foul ball.
 */
export function addPitch(count: Count, kind: PitchKind): Count {
  const pitches = count.pitches + 1
  if (kind === 'ball') return { balls: Math.min(4, count.balls + 1), strikes: count.strikes, pitches }
  if (kind === 'strike') return { balls: count.balls, strikes: Math.min(3, count.strikes + 1), pitches }
  if (kind === 'foul') {
    return { balls: count.balls, strikes: count.strikes < 2 ? count.strikes + 1 : count.strikes, pitches }
  }
  return { ...count, pitches }
}

/**
 * The result a full count implies, if any. Offered — never applied on its own.
 * A coach who taps a fourth ball and finds the runner already on first, in the
 * wrong place, has to undo something they never did.
 */
export function impliedResult(count: Count): PAResult | null {
  if (count.balls >= 4) return 'BB'
  if (count.strikes >= 3) return 'K'
  return null
}

// ── Advancing the runners ──────────────────────────────

function occupied(b: Bases): number {
  return (b.first ? 1 : 0) + (b.second ? 1 : 0) + (b.third ? 1 : 0)
}

/**
 * Where everyone ends up, before the coach corrects it.
 *
 * These are DEFAULTS and nothing more. A single scores the runner from second
 * about as often as it doesn't, and no table knows which. The screen shows the
 * result of this and lets the coach drag anyone anywhere before it is written
 * — which is exactly what they do with a pencil.
 */
export function applyPA(
  state: GameState,
  result: PAResult,
  batter: Runner
): { bases: Bases; outs: number; scored: Runner[] } {
  const cfg = PA_RESULTS[result]
  const b = state.bases
  const scored: Runner[] = []
  let bases: Bases = { ...EMPTY_BASES }

  // Runners who score are collected in order from third, so the scorebook
  // reads the way the play looked.
  const score = (r: Runner | null) => { if (r) scored.push(r) }

  switch (result) {
    case 'HR':
      score(b.third); score(b.second); score(b.first); score(batter)
      break

    case '3B':
      score(b.third); score(b.second); score(b.first)
      bases = { first: null, second: null, third: batter }
      break

    case '2B':
      // Everyone advances two: first to third, second and third score.
      score(b.third); score(b.second)
      bases = { first: null, second: batter, third: b.first }
      break

    case '1B':
    case 'E':
      // The conservative read — one base each. The coach moves anyone who took
      // an extra one, which on this play is the common correction.
      score(b.third)
      bases = {
        first: { ...batter, earned: result === 'E' ? false : batter.earned },
        second: b.first,
        third: b.second,
      }
      break

    case 'BB':
    case 'IBB':
    case 'HBP':
    case 'CI': {
      // Forced only, and the force runs backwards from the batter. A walk does
      // NOT move a runner on second when first is open, and a book that
      // advances them is wrong in the way that costs a run three innings later
      // when nothing adds up.
      let second = b.second
      let third = b.third
      if (b.first) {
        if (b.second) {
          if (b.third) score(b.third)   // bases loaded — forced home
          third = b.second
          second = b.first
        } else {
          second = b.first
        }
      }
      bases = { first: batter, second, third }
      break
    }

    case 'SAC':
      // Bunt: everyone moves up one, nobody scores from third by default —
      // a squeeze is a correction the coach makes on the sheet.
      score(b.third)
      bases = { first: null, second: b.first, third: b.second }
      break

    case 'SF':
      score(b.third)
      bases = { first: b.first, second: b.second, third: null }
      break

    case 'FC':
      // The batter reaches and the lead FORCED runner is out. Which runner
      // that is depends on who's on: bases loaded means the throw goes home,
      // first and second means third base, first alone means second. The
      // runners behind the out are still forced up.
      if (b.first && b.second && b.third) {
        // Runner from third is out at home; he does not score.
        bases = { first: batter, second: b.first, third: b.second }
      } else if (b.first && b.second) {
        bases = { first: batter, second: b.first, third: b.third }
      } else if (b.first) {
        bases = { first: batter, second: b.second, third: b.third }
      } else {
        // No force anywhere — a fielder's choice here is a runner thrown out
        // going first-to-third or similar. Default to nobody out but the
        // batter on, and let the coach fix the bases.
        bases = { first: batter, second: b.second, third: b.third }
      }
      break

    case 'DP':
      // Batter and the runner on first, by default — 6-4-3 and 4-6-3 are most
      // of the double plays anyone will ever score.
      bases = { first: null, second: b.second, third: b.third }
      break

    case 'TP':
      bases = { ...EMPTY_BASES }
      break

    default:
      // Strikeouts and balls caught in the air: nobody moves.
      bases = { ...b }
      break
  }

  const outs = Math.min(3, state.outs + cfg.outs)

  // Three outs ends it: runners left on base do not score, whatever the
  // defaults above said. A run that crossed before the third out on a
  // non-force play is the coach's call and they can add it.
  if (outs >= 3 && cfg.outs > 0) {
    return { bases: { ...EMPTY_BASES }, outs, scored: result === 'HR' ? scored : [] }
  }

  return { bases, outs, scored }
}

/**
 * Runners moving without a plate appearance.
 *
 * `from` is the base the runner is leaving: 1, 2 or 3. Home is not a base you
 * leave.
 */
export function applyBaseEvent(
  state: GameState,
  result: BaseResult,
  from: 1 | 2 | 3
): { bases: Bases; outs: number; scored: Runner[] } {
  const b = state.bases
  const runner = from === 1 ? b.first : from === 2 ? b.second : b.third
  const scored: Runner[] = []
  const bases: Bases = { ...b }

  if (!runner) return { bases, outs: state.outs, scored }

  const cfg = BASE_RESULTS[result]

  // Off the base they left, either way.
  if (from === 1) bases.first = null
  else if (from === 2) bases.second = null
  else bases.third = null

  if (cfg.outs > 0) {
    return { bases, outs: Math.min(3, state.outs + cfg.outs), scored: [] }
  }

  const moved = cfg.unearned ? { ...runner, earned: false } : runner
  if (from === 1) bases.second = moved
  else if (from === 2) bases.third = moved
  else scored.push(moved)

  return { bases, outs: state.outs, scored }
}

// ── The half-inning ────────────────────────────────────

/**
 * Whether we bat in this half, given which dugout we're in.
 */
export function weAreBatting(half: Half, isHome: boolean): boolean {
  return isHome ? half === 'bottom' : half === 'top'
}

/**
 * Three outs. The bases clear, the outs reset, and the half turns over —
 * derived in one place so the screen, the API and the box score agree on when
 * an inning ended.
 */
export function advanceIfHalfOver(state: GameState): GameState {
  if (state.outs < 3) return state
  return {
    ...state,
    inning: state.half === 'bottom' ? state.inning + 1 : state.inning,
    half: state.half === 'top' ? 'bottom' : 'top',
    outs: 0,
    bases: { ...EMPTY_BASES },
  }
}

// ── Reading the book ───────────────────────────────────

export interface StoredEvent {
  seq: number
  kind: EventKind
  inning: number
  half: Half
  weBatting: boolean
  result: string
  batterId: string | null
  batterName: string | null
  pitcherId: string | null
  balls: number
  strikes: number
  pitches: number
  rbi: number
  outsAfter: number
  basesAfter: Bases
  scored: Runner[]
  scoring: string | null
}

export interface BattingLine {
  playerId: string
  name: string
  pa: number
  ab: number
  h: number
  singles: number
  doubles: number
  triples: number
  hr: number
  bb: number
  k: number
  rbi: number
  runs: number
  hbp: number
  sb: number
  lob: number
}

export interface PitchingLine {
  playerId: string
  name: string
  outs: number
  pitches: number
  strikes: number
  balls: number
  h: number
  bb: number
  k: number
  runs: number
  earned: number
  hbp: number
}

/**
 * The box score, derived. Nothing here is stored, so nothing here can drift
 * from the events it came from.
 */
export function boxScore(events: StoredEvent[], names: Record<string, string>): {
  batting: BattingLine[]
  pitching: PitchingLine[]
  lineScore: { inning: number; away: number; home: number }[]
  awayRuns: number
  homeRuns: number
} {
  const batting: Record<string, BattingLine> = {}
  const pitching: Record<string, PitchingLine> = {}
  const line: Record<number, { away: number; home: number }> = {}

  const bat = (id: string, name: string): BattingLine =>
    (batting[id] ||= {
      playerId: id, name, pa: 0, ab: 0, h: 0, singles: 0, doubles: 0, triples: 0,
      hr: 0, bb: 0, k: 0, rbi: 0, runs: 0, hbp: 0, sb: 0, lob: 0,
    })
  const pit = (id: string, name: string): PitchingLine =>
    (pitching[id] ||= {
      playerId: id, name, outs: 0, pitches: 0, strikes: 0, balls: 0,
      h: 0, bb: 0, k: 0, runs: 0, earned: 0, hbp: 0,
    })

  let prevOuts = 0
  let prevHalf: Half | null = null

  for (const e of events) {
    const cell = (line[e.inning] ||= { away: 0, home: 0 })
    const runs = (e.scored || []).length
    if (e.half === 'top') cell.away += runs
    else cell.home += runs

    // Outs recorded on this event, from the snapshots rather than the result
    // table — an override the coach made is in the snapshot and not in the
    // table, and the snapshot is what happened.
    const outsHere = prevHalf === e.half ? Math.max(0, e.outsAfter - prevOuts) : e.outsAfter
    prevOuts = e.outsAfter
    prevHalf = e.half

    // Our batters
    if (e.kind === 'pa' && e.weBatting && e.batterId) {
      const b = bat(e.batterId, names[e.batterId] || e.batterName || 'Unknown')
      const cfg = PA_RESULTS[e.result as PAResult]
      b.pa += 1
      b.rbi += e.rbi || 0
      if (cfg) {
        if (cfg.atBat) b.ab += 1
        if (cfg.hit) b.h += 1
        if (e.result === '1B') b.singles += 1
        if (e.result === '2B') b.doubles += 1
        if (e.result === '3B') b.triples += 1
        if (e.result === 'HR') b.hr += 1
        if (e.result === 'BB' || e.result === 'IBB') b.bb += 1
        if (e.result === 'HBP') b.hbp += 1
        if (e.result === 'K' || e.result === 'KL') b.k += 1
      }
    }

    if (e.kind === 'base' && e.weBatting && e.result === 'SB' && e.batterId) {
      bat(e.batterId, names[e.batterId] || e.batterName || 'Unknown').sb += 1
    }

    // Runs are credited to whoever crossed the plate, which is not usually the
    // batter — the whole reason the runner is carried on the event.
    if (e.weBatting) {
      for (const r of e.scored || []) {
        // The run belongs to the player, not to the trip. Older rows have no
        // playerId and fall back to the id, which was the player id then.
        const who = r.playerId || r.id
        if (!who) continue
        bat(who, names[who] || r.name).runs += 1
      }
    }

    // Our pitchers: everything that happened while the other side batted
    if (!e.weBatting && e.pitcherId) {
      const p = pit(e.pitcherId, names[e.pitcherId] || 'Unknown')
      p.outs += outsHere
      p.pitches += e.pitches || 0
      p.strikes += e.strikes || 0
      p.balls += e.balls || 0
      p.runs += runs
      p.earned += (e.scored || []).filter(r => r.earned).length
      if (e.kind === 'pa') {
        const cfg = PA_RESULTS[e.result as PAResult]
        if (cfg?.hit) p.h += 1
        if (e.result === 'BB' || e.result === 'IBB') p.bb += 1
        if (e.result === 'HBP') p.hbp += 1
        if (e.result === 'K' || e.result === 'KL') p.k += 1
      }
    }
  }

  const innings = Object.keys(line).map(Number).sort((a, b) => a - b)
  const lineScore = innings.map(i => ({ inning: i, away: line[i].away, home: line[i].home }))

  return {
    batting: Object.values(batting).sort((a, b) => b.pa - a.pa),
    pitching: Object.values(pitching).sort((a, b) => b.outs - a.outs),
    lineScore,
    awayRuns: lineScore.reduce((s, l) => s + l.away, 0),
    homeRuns: lineScore.reduce((s, l) => s + l.home, 0),
  }
}

/** Innings pitched, the way a scorebook prints it: 4.2, not 4.667. */
export function ip(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

/** A batting average that doesn't lie when there are no at-bats yet. */
export function avg(h: number, ab: number): string {
  if (ab === 0) return '—'
  return h === ab ? '1.000' : (h / ab).toFixed(3).slice(1)
}

/**
 * How the play reads in the book: "6-3", "F8", "E5".
 *
 * Built from the positions the coach tapped rather than typed, because a coach
 * on a phone will not type "6-4-3" and a scorebook without the fielders in it
 * is only half a scorebook.
 */
export function scoringNotation(result: PAResult, fielders: string[]): string {
  const nums = fielders.filter(Boolean).join('-')
  if (!nums) return PA_RESULTS[result]?.short || result
  if (result === 'FO' || result === 'SF') return `F${nums}`
  if (result === 'LO') return `L${nums}`
  if (result === 'PO') return `P${nums}`
  if (result === 'E') return `E${nums}`
  return nums
}

// The fielding positions, by their scorekeeping numbers. Every coach who has
// ever kept a book knows 6-3; nobody wants to type it.
export const POSITION_NUMBERS: Array<{ n: string; pos: string }> = [
  { n: '1', pos: 'P' },
  { n: '2', pos: 'C' },
  { n: '3', pos: '1B' },
  { n: '4', pos: '2B' },
  { n: '5', pos: '3B' },
  { n: '6', pos: 'SS' },
  { n: '7', pos: 'LF' },
  { n: '8', pos: 'CF' },
  { n: '9', pos: 'RF' },
]
