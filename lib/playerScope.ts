// Which player a request may read about.
//
// Private player context — the name, age, notes, traits, measurements, plans —
// is reached by player id. A player id on its own is not a permission: it says
// which child, not whether this caller may read about them. This module answers
// the second question from the data, and every read of private player context
// asks it first.
//
// THE RULE
//
//   With a team in scope: the player belongs to that team — on its roster now,
//   or archived from it. Archiving keeps a player's records under the team on
//   purpose (lib/rosterArchive.ts), so an end-of-season report for a player who
//   has moved on is still the team's to write.
//
//   Without a team: the player belongs to the coach — players.coach_id — which
//   is how a Personal-plan player with no team is owned. The coach id passed
//   here must be the caller's OWN coach account; lib/authz.authorizePlayer is
//   what establishes that from the session. Being staff on somebody's team does
//   not make their team-less players yours.
//
// A missing player and a player outside the scope give the same answer, so the
// result never says which one it was.
//
// This is the STRUCTURAL half: it takes the scope it is given and checks the
// player against it. Callers that act for a signed-in user get the scope from
// lib/authz.authorizePlayer, which checks the caller first. The shared context
// builders call this directly as a second check, because they read through the
// service role and must not trust a player id however it reached them.

export interface PlayerScopeInput {
  playerId: string | null | undefined
  teamId?: string | null
  /** Required when there is no team: the coach who owns the player. */
  ownerCoachId?: string | null
}

export type PlayerScope =
  | { ok: true; playerId: string; teamId: string; via: 'roster' | 'archive' }
  | { ok: true; playerId: string; teamId: null; via: 'owner' }
  | { ok: false }

const NO: PlayerScope = { ok: false }

async function exists(q: PromiseLike<{ data: any; error: any }>): Promise<boolean | null> {
  const { data, error } = await q
  // An error is not a yes. The caller treats null as "could not establish",
  // which fails closed exactly like false.
  if (error) return null
  return !!data
}

export async function resolvePlayerScope(supabase: any, input: PlayerScopeInput): Promise<PlayerScope> {
  const playerId = typeof input.playerId === 'string' ? input.playerId.trim() : ''
  if (!playerId) return NO

  try {
    if (input.teamId) {
      const teamId = input.teamId
      const onRoster = await exists(supabase.from('team_players').select('id')
        .eq('team_id', teamId).eq('player_id', playerId).limit(1).maybeSingle())
      if (onRoster) return { ok: true, playerId, teamId, via: 'roster' }

      // The archive table arrived in migration 061. A database without it
      // answers with an error, which counts as "not archived here".
      const archived = await exists(supabase.from('team_player_archive').select('id')
        .eq('team_id', teamId).eq('player_id', playerId).limit(1).maybeSingle())
      return archived ? { ok: true, playerId, teamId, via: 'archive' } : NO
    }

    if (!input.ownerCoachId) return NO
    const owned = await exists(supabase.from('players').select('id')
      .eq('id', playerId).eq('coach_id', input.ownerCoachId).maybeSingle())
    return owned ? { ok: true, playerId, teamId: null, via: 'owner' } : NO
  } catch {
    return NO
  }
}

/**
 * Of these player ids, the ones that belong to this team. For lists — a set of
 * conversations, say — where checking one at a time would be a query per row.
 */
export async function playersOnTeam(supabase: any, teamId: string, playerIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(playerIds.filter(Boolean)))
  const out = new Set<string>()
  if (!teamId || ids.length === 0) return out
  try {
    const [roster, archive] = await Promise.all([
      supabase.from('team_players').select('player_id').eq('team_id', teamId).in('player_id', ids),
      supabase.from('team_player_archive').select('player_id').eq('team_id', teamId).in('player_id', ids),
    ])
    for (const r of (roster?.data || [])) out.add(r.player_id)
    for (const r of (archive?.error ? [] : archive?.data || [])) out.add(r.player_id)
  } catch { /* nothing established, nothing returned */ }
  return out
}
