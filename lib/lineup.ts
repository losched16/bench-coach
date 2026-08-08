// Fielding assignment — solved, not generated.
//
// This used to be a Sonnet call. The prompt ended with a list of pleadings:
// "Every player must appear in EVERY inning", "Only assign C, P, 1B to
// eligible players". Those are constraints, and a language model satisfies
// constraints usually rather than always — it will occasionally put a kid at
// two positions in one inning, or drop someone from an inning entirely. A
// coach who gets that once stops trusting the feature.
//
// So the constraints live here, in code, where they hold. What stays with the
// model is the part that is actually judgment: who hits where, and why.
//
// THE OBJECTIVE FUNCTION DEPENDS ON WHO IS ASKING
//
// Rec coaches want fairness: equal innings, everyone gets an infield rep, no
// kid buried in right field. Travel coaches want the best glove at shortstop
// in a game they are trying to win. Those are opposite goals and the same
// algorithm can serve both — the difference is one term in the score.

// 'development' spreads innings and positions — the rec default, where the
// point is that everyone plays everywhere. 'competitive' keeps the best
// available arrangement and holds players in one spot, which is how travel
// actually runs: a settled defence with a few moving pieces.
export type Strategy = 'development' | 'competitive'

// How the batting order works. Travel varies by tournament and even by game,
// which is why this is a per-lineup choice rather than a team setting.
export type LineupMode =
  | 'continuous'  // everyone bats, rec-style
  | 'fixed_9'     // nine hitters, the rest are subs
  | 'fixed_10'    // ten hitters (EH/DH), nine field

export interface LineupPlayer {
  id: string
  name: string
  jersey_number?: string | null
  hitting_level?: number | null
  throwing_level?: number | null
  fielding_level?: number | null
  pitching_level?: number | null
  // Positions the coach flagged this player as able to handle
  eligiblePositions?: string[]
  // How many innings at each position across recent games, for fairness
  positionHistory?: Record<string, number>
  // Present when the player is unavailable this game
  out?: boolean

  // ── Coach constraints ────────────────────────────────
  // Hard rules the solver may not trade away for fairness or fit. A coach who
  // finds their catcher in right field because the optimiser wanted variety
  // stops trusting the optimiser.

  // "RJ only plays short." When set, this player takes no other position, and
  // the position prefers them over anyone else eligible.
  lockedPosition?: string | null
  // "Lucas can play anywhere except first." Cheaper to express than listing
  // the eight he can play.
  excludedPositions?: string[]
  // League rules and promises. 8U travel usually requires every kid to field
  // at least one inning; a pitcher on a count may be capped.
  minInnings?: number | null
  maxInnings?: number | null
}

export interface FieldingOptions {
  innings: number
  fieldPositions: number          // 9 or 10 (10 adds a fourth outfielder)
  strategy: Strategy
  lineupMode: LineupMode
  // Set for fixed modes — only these players bat. Everyone may still field.
  battingOrderIds?: string[]
  // Bats but never takes the field.
  dhPlayerId?: string | null
  // Coach pitch / machine pitch means no player pitcher is needed.
  needsPitcher: boolean
  // Applied to every player without their own minimum. This is how "everyone
  // plays at least one inning" gets expressed once instead of per kid.
  minInningsAll?: number
}

export interface Assignment { team_player_id: string; name: string; position: string }
export interface FieldingPlan {
  field_assignments: Record<string, Assignment[]>
  bench_by_inning: Record<string, Array<{ team_player_id: string; name: string }>>
  // Things the coach needs to know rather than silent compromises
  warnings: string[]
  // Innings in the field per player, so the UI can show the fairness it claims
  innings_by_player: Record<string, number>
}

// Positions where a weak player costs you runs, hardest first. Filled in this
// order so the scarce eligible players land where they matter.
export const PREMIUM_POSITIONS = ['C', 'P', 'SS', '1B', '3B', '2B']
export const KEY_POSITIONS = ['C', 'P', '1B']

const INFIELD = new Set(['P', 'C', '1B', '2B', '3B', 'SS'])

export function positionsFor(fieldPositions: number, needsPitcher: boolean): string[] {
  const base = fieldPositions === 10
    ? ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF']
    : ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
  // In coach/machine pitch there is no player on the mound. Most leagues put a
  // fielder near it; dropping the slot entirely would bench an extra kid.
  return needsPitcher ? base : base.map(p => (p === 'P' ? 'Rover' : p))
}

function isEligible(player: LineupPlayer, position: string, needsPitcher: boolean): boolean {
  // Coach constraints come first: they are rules, not preferences, and the
  // solver must never trade one away for a better fit.
  if (player.lockedPosition && player.lockedPosition !== position) return false
  if ((player.excludedPositions || []).includes(position)) return false

  // Only the key positions gate on the coach's flags. Everything else is open,
  // because a coach who has to flag nine positions per kid never uses this.
  if (!KEY_POSITIONS.includes(position)) return true
  if (position === 'P' && !needsPitcher) return true
  return (player.eligiblePositions || []).includes(position)
}

// Whether this player still needs innings to satisfy a minimum, and how
// urgently. Returned as innings still owed against innings still available —
// once those are equal they have to play every remaining inning or the promise
// breaks, and no fit score should be allowed to outweigh that.
function inningsOwed(
  player: LineupPlayer,
  opts: FieldingOptions,
  played: number,
  inningsLeft: number
): { owed: number; mustPlayNow: boolean } {
  const min = player.minInnings ?? opts.minInningsAll ?? 0
  const owed = Math.max(0, min - played)
  return { owed, mustPlayNow: owed > 0 && owed >= inningsLeft }
}

function atMax(player: LineupPlayer, played: number): boolean {
  return player.maxInnings != null && played >= player.maxInnings
}

// How well this player fits this position, before fairness is considered.
function fitScore(player: LineupPlayer, position: string): number {
  const field = player.fielding_level || 3
  const throwing = player.throwing_level || 3
  const pitching = player.pitching_level || 3

  if (position === 'P') return pitching * 2 + throwing
  if (position === 'C') return field * 2 + throwing
  if (position === 'SS' || position === '3B') return field * 2 + throwing
  if (position === '1B') return field + throwing * 0.5
  if (INFIELD.has(position)) return field * 1.5 + throwing * 0.5
  return field + throwing * 0.5
}

export function buildFieldingPlan(
  players: LineupPlayer[],
  opts: FieldingOptions
): FieldingPlan {
  const available = players.filter(p => !p.out)
  const positions = positionsFor(opts.fieldPositions, opts.needsPitcher)
  const warnings: string[] = []

  // The DH bats and does not field. Everyone else is in the fielding pool.
  const fieldPool = available.filter(p => p.id !== opts.dhPlayerId)

  const field_assignments: Record<string, Assignment[]> = {}
  const bench_by_inning: Record<string, Array<{ team_player_id: string; name: string }>> = {}
  const inningsPlayed: Record<string, number> = {}
  const benchCount: Record<string, number> = {}
  // Positions already played THIS game, so a kid isn't parked in right field
  const playedThisGame: Record<string, Set<string>> = {}

  for (const p of fieldPool) {
    inningsPlayed[p.id] = 0
    benchCount[p.id] = 0
    playedThisGame[p.id] = new Set()
  }

  if (fieldPool.length < positions.length) {
    warnings.push(
      `Only ${fieldPool.length} players available for ${positions.length} positions. ` +
      `You'll be playing short — the plan leaves the last ${positions.length - fieldPool.length} ` +
      `position(s) unfilled rather than inventing someone.`
    )
  }

  // Unfillable key positions are a setup problem, not an inning problem. Say
  // it once, up front — the per-inning check below would otherwise repeat the
  // same sentence six times and bury the fix.
  const keyPositionsInUse = positions.filter(pos =>
    KEY_POSITIONS.includes(pos) && (pos !== 'P' || opts.needsPitcher)
  )
  const unflagged = keyPositionsInUse.filter(
    pos => !fieldPool.some(p => (p.eligiblePositions || []).includes(pos))
  )
  if (unflagged.length > 0) {
    warnings.push(
      `Nobody is flagged for ${unflagged.join(' or ')}, so ${unflagged.length === 1 ? 'that spot is' : 'those spots are'} ` +
      `left empty every inning. Flag someone on the eligibility grid and regenerate.`
    )
  }

  // Constraints that cannot be satisfied are a setup problem, and saying so
  // once beforehand beats a plan that quietly breaks a promise.
  for (const p of fieldPool) {
    if (p.lockedPosition && !positions.includes(p.lockedPosition)) {
      warnings.push(
        `${p.name} is locked to ${p.lockedPosition}, which isn't a position in this alignment. ` +
        `They'll sit unless you unlock them.`
      )
    }
  }

  const lockedByPosition: Record<string, string[]> = {}
  for (const p of fieldPool) {
    if (p.lockedPosition) (lockedByPosition[p.lockedPosition] ||= []).push(p.name)
  }
  for (const [pos, names] of Object.entries(lockedByPosition)) {
    if (names.length > 1) {
      warnings.push(
        `${names.join(' and ')} are all locked to ${pos}. Only one can play it at a time, ` +
        `so the others sit — unlock all but one.`
      )
    }
  }

  // Do the minimums even fit? Innings available is positions x innings.
  const totalSlots = positions.length * opts.innings
  const demanded = fieldPool.reduce(
    (sum, p) => sum + (p.minInnings ?? opts.minInningsAll ?? 0), 0
  )
  if (demanded > totalSlots) {
    warnings.push(
      `The minimum innings you've set add up to ${demanded}, but there are only ${totalSlots} ` +
      `fielding slots in ${opts.innings} innings. Something has to give — lower a minimum or play more innings.`
    )
  }

  for (let inning = 1; inning <= opts.innings; inning++) {
    const assigned = new Set<string>()
    const rows: Assignment[] = []

    for (const position of orderPositionsForFilling(positions)) {
      const inningsLeft = opts.innings - inning + 1
      const candidates = fieldPool
        .filter(p => !assigned.has(p.id))
        .filter(p => isEligible(p, position, opts.needsPitcher))
        // A cap is a cap. Someone on a pitch count who is done for the day
        // should not reappear because the optimiser liked their glove.
        .filter(p => !atMax(p, inningsPlayed[p.id]))

      if (candidates.length === 0) {
        // Only worth saying when the pool exists but was used up this inning —
        // "nobody is flagged at all" was already reported once, above.
        if (KEY_POSITIONS.includes(position) && !unflagged.includes(position)) {
          warnings.push(
            `Inning ${inning}: everyone flagged for ${position} is already placed. ` +
            `Flag another player for ${position}, or fill it yourself.`
          )
        }
        continue
      }

      const best = candidates.reduce((a, b) =>
        scoreCandidate(b, position, opts, inningsPlayed, playedThisGame, inningsLeft) >
        scoreCandidate(a, position, opts, inningsPlayed, playedThisGame, inningsLeft) ? b : a
      )

      assigned.add(best.id)
      inningsPlayed[best.id] += 1
      playedThisGame[best.id].add(position)
      rows.push({ team_player_id: best.id, name: best.name, position })
    }

    field_assignments[String(inning)] = rows
    const benched = fieldPool.filter(p => !assigned.has(p.id))
    for (const p of benched) benchCount[p.id] += 1
    bench_by_inning[String(inning)] = benched.map(p => ({ team_player_id: p.id, name: p.name }))
  }

  // Say out loud when development mode couldn't actually be fair, rather than
  // letting the coach discover it from a parent — and name the real cause.
  // Usually it isn't roster maths, it's that only two kids can catch, so those
  // two never come off. That's fixable from the eligibility grid, and the
  // coach can only fix it if we say so.
  if (opts.strategy === 'development' && fieldPool.length > positions.length) {
    const counts = Object.values(inningsPlayed)
    const spread = Math.max(...counts) - Math.min(...counts)
    if (spread > 1) {
      // A key position with a pool of one pins that child to the field all
      // game — the most common reason a "fair rotation" isn't fair, and the
      // one the coach can fix in ten seconds on the eligibility grid.
      const thin = keyPositionsInUse
        .filter(pos => !unflagged.includes(pos))
        .map(pos => ({
          pos,
          pool: fieldPool.filter(p => (p.eligiblePositions || []).includes(pos)),
        }))
        .filter(x => x.pool.length === 1)

      const eligibleForAnyKey = fieldPool.filter(p =>
        (p.eligiblePositions || []).some(pos => KEY_POSITIONS.includes(pos))
      )
      const aggregateBind =
        eligibleForAnyKey.length > 0 && eligibleForAnyKey.length <= keyPositionsInUse.length

      if (thin.length > 0) {
        warnings.push(
          thin.map(x =>
            `${x.pool[0].name} plays every inning because they're the only player flagged for ${x.pos}.`
          ).join(' ') +
          ` Flag one more player for ${thin.map(x => x.pos).join(' and ')} and the rotation evens out.`
        )
      } else if (aggregateBind) {
        const names = eligibleForAnyKey.map(p => p.name).join(', ')
        warnings.push(
          `${names} can't come off: ${eligibleForAnyKey.length} player${eligibleForAnyKey.length === 1 ? '' : 's'} ` +
          `flagged for ${keyPositionsInUse.length} key positions (${keyPositionsInUse.join(', ')}). ` +
          `Flag one more and they get a rest.`
        )
      } else {
        warnings.push(
          `Field innings vary by ${spread} across the roster. With ${fieldPool.length} players and ` +
          `${positions.length} spots over ${opts.innings} innings, that's the closest even split available.`
        )
      }
    }
  }

  // Report broken promises explicitly. The scoring makes these rare, but a
  // roster with heavy locks and thin eligibility can still box the solver in,
  // and a coach who was told "everyone plays one" needs to hear that it
  // didn't happen — before the game, not from a parent afterwards.
  for (const p of fieldPool) {
    const min = p.minInnings ?? opts.minInningsAll ?? 0
    if (min > 0 && inningsPlayed[p.id] < min) {
      warnings.push(
        `${p.name} only gets ${inningsPlayed[p.id]} of the ${min} innings you asked for. ` +
        `Usually a lock or a position they can't play is squeezing them out — swap someone manually.`
      )
    }
    if (p.lockedPosition && inningsPlayed[p.id] === 0 && positions.includes(p.lockedPosition)) {
      warnings.push(
        `${p.name} is locked to ${p.lockedPosition} but never gets on the field — ` +
        `someone else is holding that spot every inning.`
      )
    }
  }

  return { field_assignments, bench_by_inning, warnings, innings_by_player: inningsPlayed }
}

// Premium positions first: they have the fewest eligible bodies, so filling
// them last is how you end up with nobody left who can catch.
function orderPositionsForFilling(positions: string[]): string[] {
  return [...positions].sort((a, b) => {
    const ra = PREMIUM_POSITIONS.indexOf(a)
    const rb = PREMIUM_POSITIONS.indexOf(b)
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb)
  })
}

function scoreCandidate(
  player: LineupPlayer,
  position: string,
  opts: FieldingOptions,
  inningsPlayed: Record<string, number>,
  playedThisGame: Record<string, Set<string>>,
  inningsLeft: number
): number {
  const fit = fitScore(player, position)
  const played = inningsPlayed[player.id]

  // A locked player owns their position. Without this the solver could put a
  // better glove at short and leave the locked kid on the bench all game,
  // which is the opposite of what locking them meant.
  const lockBonus = player.lockedPosition === position ? 1000 : 0

  // Running out of innings to keep a minimum outranks everything except a
  // lock. "Every kid plays an inning" is a league rule or a promise to a
  // parent, not a preference to be optimised against.
  const { owed, mustPlayNow } = inningsOwed(player, opts, played, inningsLeft)
  const owedBonus = mustPlayNow ? 500 : owed > 0 ? 20 : 0

  if (opts.strategy === 'competitive') {
    // Win the game, and keep the defence settled: travel runs a set lineup
    // with a few moving pieces, so a player already at this position stays
    // there rather than being shuffled for variety.
    const consistencyBonus = playedThisGame[player.id].has(position) ? 6 : 0
    return lockBonus + owedBonus + fit * 10 + consistencyBonus - played * 0.5
  }

  // Development: the fairness terms outweigh fit on purpose.
  const restBonus = -inningsPlayed[player.id] * 6
  // Push toward positions this kid hasn't had yet today
  const varietyBonus = playedThisGame[player.id].has(position) ? -8 : 3
  // And toward positions they rarely get across the season
  const seasonReps = player.positionHistory?.[position] ?? 0
  const seasonBonus = -Math.min(seasonReps, 6) * 1.5
  const infieldSpread = INFIELD.has(position) && !hasPlayedInfield(playedThisGame[player.id]) ? 4 : 0

  return lockBonus + owedBonus + fit + restBonus + varietyBonus + seasonBonus + infieldSpread
}

function hasPlayedInfield(played: Set<string>): boolean {
  return Array.from(played).some(p => INFIELD.has(p))
}

// ── Validation ─────────────────────────────────────────
// The whole reason this moved out of the model. Run it in tests, and at
// runtime, so a broken plan is caught by us and not by a parent at the fence.

export function validateFieldingPlan(
  plan: FieldingPlan,
  players: LineupPlayer[],
  opts: FieldingOptions
): string[] {
  const errors: string[] = []
  const available = players.filter(p => !p.out)
  const fieldPool = available.filter(p => p.id !== opts.dhPlayerId)
  const byId = new Map(fieldPool.map(p => [p.id, p]))

  for (let inning = 1; inning <= opts.innings; inning++) {
    const rows = plan.field_assignments[String(inning)] || []
    const bench = plan.bench_by_inning[String(inning)] || []

    const seen = new Set<string>()
    for (const row of rows) {
      if (seen.has(row.team_player_id)) {
        errors.push(`Inning ${inning}: ${row.name} is assigned to two positions`)
      }
      seen.add(row.team_player_id)

      const player = byId.get(row.team_player_id)
      if (!player) {
        errors.push(`Inning ${inning}: ${row.name} is not in the fielding pool`)
        continue
      }
      if (KEY_POSITIONS.includes(row.position) && !isEligible(player, row.position, opts.needsPitcher)) {
        errors.push(`Inning ${inning}: ${row.name} is not flagged eligible for ${row.position}`)
      }
    }

    const positionsSeen = rows.map(r => r.position)
    if (new Set(positionsSeen).size !== positionsSeen.length) {
      errors.push(`Inning ${inning}: a position is filled twice`)
    }

    // Every available player is either on the field or on the bench, never
    // silently missing — the failure mode that made this worth rewriting.
    const accounted = new Set([...Array.from(seen), ...bench.map(b => b.team_player_id)])
    for (const p of fieldPool) {
      if (!accounted.has(p.id)) {
        errors.push(`Inning ${inning}: ${p.name} is neither fielding nor on the bench`)
      }
    }
  }

  return errors
}

// ── Batting order helpers ──────────────────────────────

export function battingSlots(mode: LineupMode, rosterSize: number): number {
  if (mode === 'fixed_9') return Math.min(9, rosterSize)
  if (mode === 'fixed_10') return Math.min(10, rosterSize)
  return rosterSize
}

export const LINEUP_MODES: Record<LineupMode, { label: string; hint: string }> = {
  continuous: {
    label: 'Everyone bats',
    hint: 'Continuous order — standard for rec and most 8U/10U travel pool play.',
  },
  fixed_9: {
    label: '9 batters',
    hint: 'Fixed order, the rest are subs.',
  },
  fixed_10: {
    label: '10 batters (EH/DH)',
    hint: 'Ten in the order, nine in the field.',
  },
}

// Named for the league they belong to, because that is how a coach picks.
export const STRATEGIES: Record<Strategy, { label: string; hint: string }> = {
  development: {
    label: 'Rec — fair rotation',
    hint: 'Equal innings, everyone gets infield reps, nobody buried in right field. Positions move every inning.',
  },
  competitive: {
    label: 'Travel — set lineup',
    hint: 'Best glove at every spot, and players stay there rather than rotating. Set minimum innings so nobody is forgotten.',
  },
}
