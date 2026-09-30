// Which observations a coaching context may read.
//
// An observation belongs to the team it was recorded against, not to the coach
// who typed it. Capture stores the signed-in user's own coach id — for an
// assistant that is their coach account, not the team owner's — so a read
// filtered by the owner's coach id silently drops everything an assistant
// wrote. With a team in scope, the team is the filter: every coach on the team
// contributes, and nothing recorded against another team can appear, even
// another team the same coach owns.
//
// With no team, nothing changes: the coach's own observations, as before.
//
// The caller has already authorized the team (every context read here runs
// through the service role, so this filter is the enforcement).

// The same rule scopes the entries those observations belong to (a report's
// logged sessions): team rows when there is a team, the coach's own when not.
//
// Unconstrained on purpose: a structural `eq` constraint against supabase-js's
// builder types trips TS2589 (instantiation too deep). Any query builder works.
export function scopeObservations<Q>(
  query: Q,
  scope: { teamId?: string | null; coachId: string; playerId?: string | null }
): Q {
  let q: any = query
  q = scope.teamId ? q.eq('team_id', scope.teamId) : q.eq('coach_id', scope.coachId)
  if (scope.playerId) q = q.eq('player_id', scope.playerId)
  return q
}
