// Who is allowed back in.
//
// Substitution rules are the one part of coaching a game where being wrong is
// not a matter of taste — it is a protest, a forfeit, or an umpire explaining
// the rulebook to you in front of the parents. So this is a rules engine, not
// a set of hints, and every answer it gives comes with the reason.
//
// It is deliberately pure: no database, no React. The swap screen and the
// in-game chat both reason from this, and the fastest way to lose a coach's
// trust is for the button and the assistant to disagree about the same move.

// ── Rule sets ──────────────────────────────────────────
//
// Youth baseball does not have one rule. These are the three that cover
// nearly every league a coach will actually stand in.

export type SubRuleSet =
  // The classic rule, and what most people mean by "substitution rules".
  // A STARTER may leave and re-enter once, and must return to the same spot
  // in the batting order. A SUBSTITUTE who leaves is done for the day.
  | 'starter_reentry'
  // Continuous batting order: everyone bats all game, so leaving the field is
  // not leaving the game. Defensive positions move freely. This is what most
  // rec leagues and a lot of 8U/10U travel actually run.
  | 'continuous_free'
  // Strict: out is out, for everyone. Rare, but some tournaments use it.
  | 'no_reentry'

export interface SubRuleConfig {
  id: SubRuleSet
  label: string
  // One line, shown where the coach picks it.
  hint: string
  // Longer, for the assistant to quote and for the rules panel.
  detail: string
}

export const SUB_RULES: Record<SubRuleSet, SubRuleConfig> = {
  starter_reentry: {
    id: 'starter_reentry',
    label: 'Starters can re-enter once',
    hint: 'A starter who comes out may go back in one time. A sub who comes out is done.',
    detail:
      'Anyone in the starting lineup may leave the game and return once, in their original ' +
      'batting order spot. A substitute who enters and is then removed cannot come back. ' +
      'This is the standard rule in most sanctioned youth baseball.',
  },
  continuous_free: {
    id: 'continuous_free',
    label: 'Everyone bats, free defensive subs',
    hint: 'Continuous batting order — moving someone off the field is not taking them out.',
    detail:
      'Every rostered player stays in the batting order all game, so nobody is ever ' +
      'substituted out of the game. Defensive positions can change as often as you like, ' +
      'and sitting an inning costs nothing. Common in rec and younger travel divisions.',
  },
  no_reentry: {
    id: 'no_reentry',
    label: 'No re-entry at all',
    hint: 'Once a player leaves the game, they are done — starter or not.',
    detail:
      'Any player removed from the game may not return, including starters. Used by some ' +
      'tournaments. Check your rulebook before choosing this one — it is the strictest option.',
  },
}

export const DEFAULT_SUB_RULES: SubRuleSet = 'starter_reentry'

// ── Game state ─────────────────────────────────────────

export interface PlayerGameState {
  teamPlayerId: string
  name: string
  // In the lineup card handed to the umpire before the first pitch.
  isStarter: boolean
  // Their spot in the batting order, 1-based. Re-entry rules key off this:
  // a starter must come back to the same slot.
  battingSlot: number | null
  // On the field or in the batting order right now.
  isIn: boolean
  // How many times they have been removed from the game. Distinct from
  // "innings on the bench" — sitting an inning in a continuous order is not
  // being removed.
  timesRemoved: number
  // How many times they have entered after being removed.
  reentries: number
}

export interface Legality {
  allowed: boolean
  // Always populated. An allowed move explains what it costs — "this is his
  // one re-entry" — because the coach needs that before deciding, not after.
  reason: string
  // Set when the move is legal but spends something that cannot be got back.
  warning?: string
}

// ── The questions a coach actually asks ────────────────

/**
 * Can this player go into the game right now?
 */
export function canEnter(p: PlayerGameState, rules: SubRuleSet): Legality {
  if (p.isIn) {
    return { allowed: false, reason: `${p.name} is already in the game.` }
  }

  if (rules === 'continuous_free') {
    return {
      allowed: true,
      reason: `Everyone bats all game, so ${p.name} was never out of it — put them anywhere on the field.`,
    }
  }

  // Never been in: always available.
  if (p.timesRemoved === 0) {
    return { allowed: true, reason: `${p.name} hasn't been in yet, so this is a straight substitution.` }
  }

  if (rules === 'no_reentry') {
    return {
      allowed: false,
      reason: `${p.name} has already been taken out, and this game is being played with no re-entry. They're done for the day.`,
    }
  }

  // starter_reentry
  if (!p.isStarter) {
    return {
      allowed: false,
      reason: `${p.name} came in as a substitute and has already been taken out. A substitute can't re-enter — only starters can.`,
    }
  }

  if (p.reentries >= 1) {
    return {
      allowed: false,
      reason: `${p.name} started and has already used their one re-entry. They can't come back a second time.`,
    }
  }

  return {
    allowed: true,
    reason: `${p.name} started, so they can come back in${
      p.battingSlot ? ` — in the ${ordinal(p.battingSlot)} spot, where they started` : ''
    }.`,
    warning: `This uses ${p.name}'s only re-entry. If you take them out again, they're done.`,
  }
}

/**
 * Can this player be taken out right now, and what does it cost?
 */
export function canExit(p: PlayerGameState, rules: SubRuleSet): Legality {
  if (!p.isIn) {
    return { allowed: false, reason: `${p.name} isn't in the game.` }
  }

  if (rules === 'continuous_free') {
    return {
      allowed: true,
      reason: `${p.name} keeps batting — this only moves them off the field, and they can go back out any inning.`,
    }
  }

  if (rules === 'no_reentry') {
    return {
      allowed: true,
      reason: `${p.name} can come out.`,
      warning: `No re-entry in this game — once ${p.name} is out, they're out for good.`,
    }
  }

  // starter_reentry
  if (p.isStarter && p.reentries === 0) {
    return {
      allowed: true,
      reason: `${p.name} can come out and still has their one re-entry available.`,
    }
  }
  if (p.isStarter) {
    return {
      allowed: true,
      reason: `${p.name} can come out.`,
      warning: `${p.name} already used their re-entry, so this is the last time — they can't come back.`,
    }
  }
  return {
    allowed: true,
    reason: `${p.name} can come out.`,
    warning: `${p.name} came in as a substitute, so once they're out they can't return.`,
  }
}

/**
 * Swapping one player for another: the whole move, judged together.
 *
 * Judged as one action because that is how it is made. Telling a coach the
 * exit is fine and then refusing the entry, after they have already sent a kid
 * to the dugout, is worse than refusing the swap.
 */
export function canSwap(
  out: PlayerGameState,
  incoming: PlayerGameState,
  rules: SubRuleSet
): Legality {
  const entry = canEnter(incoming, rules)
  if (!entry.allowed) return entry

  const exit = canExit(out, rules)
  if (!exit.allowed) return exit

  const warnings = [exit.warning, entry.warning].filter(Boolean)
  return {
    allowed: true,
    reason: `${incoming.name} in for ${out.name}. ${entry.reason}`,
    warning: warnings.length ? warnings.join(' ') : undefined,
  }
}

// ── State transitions ──────────────────────────────────
// Applied here rather than in the route so the UI can show the consequence
// before it is written, and so both agree on what a swap does.

export function applyEntry(p: PlayerGameState, rules: SubRuleSet): PlayerGameState {
  if (p.isIn) return p
  return {
    ...p,
    isIn: true,
    // Coming back after being removed is a re-entry. The first time in is not.
    reentries: p.timesRemoved > 0 && rules !== 'continuous_free' ? p.reentries + 1 : p.reentries,
  }
}

export function applyExit(p: PlayerGameState, rules: SubRuleSet): PlayerGameState {
  if (!p.isIn) return p
  // In a continuous order nobody is ever removed from the GAME, so coming off
  // the field must not burn anything. Counting it would eventually tell a
  // coach a kid can't go back out, in a league where that is always allowed.
  if (rules === 'continuous_free') return { ...p, isIn: false }
  return { ...p, isIn: false, timesRemoved: p.timesRemoved + 1 }
}

// ── For the assistant ──────────────────────────────────
// Rendered rather than dumped, so the model answers from the same facts the
// buttons enforce and cannot invent a rule that the UI would refuse.

export function renderSubstitutionState(
  players: PlayerGameState[],
  rules: SubRuleSet
): string {
  const cfg = SUB_RULES[rules]
  const inGame = players.filter(p => p.isIn)
  const available = players.filter(p => !p.isIn && canEnter(p, rules).allowed)
  const done = players.filter(p => !p.isIn && !canEnter(p, rules).allowed)

  const line = (p: PlayerGameState) => {
    const bits = [p.isStarter ? 'starter' : 'sub']
    if (p.battingSlot) bits.push(`bats ${ordinal(p.battingSlot)}`)
    if (p.timesRemoved > 0) bits.push(`out ${p.timesRemoved}x`)
    if (p.reentries > 0) bits.push(`re-entered ${p.reentries}x`)
    return `    ${p.name} (${bits.join(', ')})`
  }

  return [
    `SUBSTITUTION RULES IN FORCE: ${cfg.label}`,
    `  ${cfg.detail}`,
    '',
    `IN THE GAME (${inGame.length}):`,
    inGame.length ? inGame.map(line).join('\n') : '    (nobody)',
    '',
    `AVAILABLE TO ENTER (${available.length}):`,
    available.length ? available.map(line).join('\n') : '    (nobody)',
    '',
    `CANNOT RE-ENTER (${done.length}):`,
    done.length
      ? done.map(p => `${line(p)} — ${canEnter(p, rules).reason}`).join('\n')
      : '    (nobody)',
    '',
    'Answer substitution questions from this list only. If a move is not legal, say so and say ' +
    'which rule stops it. Never guess at a league rule that is not stated above — if the coach ' +
    'asks about something this ruleset does not cover (courtesy runners, pitching re-entry, ' +
    'injury exceptions), say it depends on their league and tell them to check the rulebook.',
  ].join('\n')
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
