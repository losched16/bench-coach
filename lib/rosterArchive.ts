// Taking a player off the roster without losing a season of work.
//
// "Remove" used to mean delete: the roster row went, and if the child was on
// no other team the player row went too, and with it every note, measurement,
// report and priority — the exact record a coach spends a season building.
// That is the wrong default for the ordinary case, which is a kid who moves
// up, moves away, or sits out a season and comes back.
//
// Archiving moves the ROSTER ROW to team_player_archive and leaves everything
// else alone. Notes, reports, metrics, priorities, observations and entries
// are keyed on player_id + team_id, not on the roster row, so they stay
// exactly where they are. Because the roster row is gone from team_players,
// every place that builds a roster — lineups, practice plans, CoachAI's
// context, the log, stats — stops seeing the player with no change of its
// own. That is the point of a separate table over a flag: the safe
// behaviour is the one nobody has to remember to code.
//
// This module is the pure half: what is kept in the archive row and how it
// is turned back into roster rows on restore. No I/O, no server imports, so
// the roster page can use it in the browser.

export interface TeamPlayerRow {
  id: string
  team_id: string
  player_id: string
  positions?: string[] | null
  hitting_level?: number | null
  throwing_level?: number | null
  fielding_level?: number | null
  pitching_level?: number | null
  baserunning_level?: number | null
  coachability_level?: number | null
  focus_notes?: string | null
  locked_position?: string | null
  excluded_positions?: string[] | null
  min_innings?: number | null
  max_innings?: number | null
}

export interface EligibilityRow {
  position: string
  eligible: boolean | null
}

/** What the archive row remembers, so a restore puts the player back as they were. */
export interface RosterSnapshot {
  positions: string[]
  hitting_level: number | null
  throwing_level: number | null
  fielding_level: number | null
  pitching_level: number | null
  baserunning_level: number | null
  coachability_level: number | null
  focus_notes: string | null
  locked_position: string | null
  excluded_positions: string[]
  min_innings: number | null
  max_innings: number | null
  eligibility: EligibilityRow[]
}

const LEVELS = [
  'hitting_level', 'throwing_level', 'fielding_level',
  'pitching_level', 'baserunning_level', 'coachability_level',
] as const

function level(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}

function text(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim()
  return s ? s : null
}

function innings(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/** The roster row and its position eligibility, as one JSON value. */
export function rosterSnapshot(
  row: TeamPlayerRow,
  eligibility: EligibilityRow[] = []
): RosterSnapshot {
  const out: any = {
    positions: strings(row.positions),
    focus_notes: text(row.focus_notes),
    locked_position: text(row.locked_position),
    excluded_positions: strings(row.excluded_positions),
    min_innings: innings(row.min_innings),
    max_innings: innings(row.max_innings),
    eligibility: eligibility
      .filter(e => e && typeof e.position === 'string' && e.position.trim())
      .map(e => ({ position: e.position.trim(), eligible: e.eligible !== false })),
  }
  for (const k of LEVELS) out[k] = level((row as any)[k])
  return out as RosterSnapshot
}

/**
 * A snapshot read back from the database. Anything missing or malformed
 * falls to the empty value, never throws: a restore must not fail because a
 * column was added after the row was archived.
 */
export function readSnapshot(raw: unknown): RosterSnapshot {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const elig = Array.isArray(r.eligibility) ? (r.eligibility as any[]) : []
  return rosterSnapshot(
    {
      id: '', team_id: '', player_id: '',
      positions: r.positions as any,
      hitting_level: r.hitting_level as any,
      throwing_level: r.throwing_level as any,
      fielding_level: r.fielding_level as any,
      pitching_level: r.pitching_level as any,
      baserunning_level: r.baserunning_level as any,
      coachability_level: r.coachability_level as any,
      focus_notes: r.focus_notes as any,
      locked_position: r.locked_position as any,
      excluded_positions: r.excluded_positions as any,
      min_innings: r.min_innings as any,
      max_innings: r.max_innings as any,
    },
    elig.map(e => ({ position: String(e?.position ?? ''), eligible: e?.eligible !== false }))
  )
}

/** The team_players row to insert on restore. Eligibility rows follow once its id is known. */
export function restoreRow(
  teamId: string,
  playerId: string,
  snap: RosterSnapshot
): Omit<TeamPlayerRow, 'id'> {
  return {
    team_id: teamId,
    player_id: playerId,
    positions: snap.positions,
    hitting_level: snap.hitting_level,
    throwing_level: snap.throwing_level,
    fielding_level: snap.fielding_level,
    pitching_level: snap.pitching_level,
    baserunning_level: snap.baserunning_level,
    coachability_level: snap.coachability_level,
    focus_notes: snap.focus_notes,
    locked_position: snap.locked_position,
    excluded_positions: snap.excluded_positions,
    min_innings: snap.min_innings,
    max_innings: snap.max_innings,
  }
}

export function restoreEligibility(
  teamPlayerId: string,
  snap: RosterSnapshot
): Array<{ team_player_id: string; position: string; eligible: boolean }> {
  return snap.eligibility.map(e => ({
    team_player_id: teamPlayerId, position: e.position, eligible: e.eligible !== false,
  }))
}
