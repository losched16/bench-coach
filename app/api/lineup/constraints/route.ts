import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { migrationHintFor } from '@/lib/migrationHints'
import { guard } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Lineup rules a coach sets once and expects to hold all season.
//
// On team_players rather than on a lineup, because "RJ only plays short" is
// true of RJ, not of Saturday. A coach who has to re-enter it every game
// enters it once and then stops using the builder.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET ?teamId= — the rules currently in force
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read', { needs: 'teamFeatures' })
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')
  if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 })

  try {
    const [{ data: team, error: teamErr }, { data: roster, error: rosterErr }] = await Promise.all([
      supabaseAdmin
        .from('teams')
        .select('id, min_innings_all, default_strategy')
        .eq('id', teamId)
        .maybeSingle(),
      supabaseAdmin
        .from('team_players')
        .select('id, locked_position, excluded_positions, min_innings, max_innings, player:players(name, jersey_number)')
        .eq('team_id', teamId),
    ])

    if (teamErr) throw teamErr
    if (rosterErr) throw rosterErr

    return NextResponse.json({
      team: {
        minInningsAll: (team as any)?.min_innings_all ?? null,
        defaultStrategy: (team as any)?.default_strategy ?? null,
      },
      players: (roster || []).map((r: any) => ({
        teamPlayerId: r.id,
        name: r.player?.name || 'Unknown',
        jerseyNumber: r.player?.jersey_number ?? null,
        lockedPosition: r.locked_position ?? null,
        excludedPositions: r.excluded_positions || [],
        minInnings: r.min_innings ?? null,
        maxInnings: r.max_innings ?? null,
      })),
    })
  } catch (error: any) {
    console.error('Lineup constraints GET error:', error)
    const hint = migrationHintFor(error)
    // The builder must still work without these — no rules is a valid state.
    return NextResponse.json({
      team: { minInningsAll: null, defaultStrategy: null },
      players: [],
      needsMigration: !!hint,
      migrationMessage: hint?.message || null,
    })
  }
}

// ---------------------------------------------------------------------------
// PATCH { teamId, team?, player? }
//   team:   { minInningsAll?, defaultStrategy? }
//   player: { teamPlayerId, lockedPosition?, excludedPositions?, minInnings?, maxInnings? }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  const denied = await guard(request, 'decide', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const body = await request.json()
    const { teamId, team, player } = body
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 })

    if (team) {
      const patch: Record<string, any> = {}
      // Presence, not truthiness: clearing a rule means writing null, and 0 is
      // a meaningful minimum.
      if ('minInningsAll' in team) {
        const n = Number(team.minInningsAll)
        patch.min_innings_all = team.minInningsAll == null || isNaN(n) ? null : Math.max(0, Math.round(n))
      }
      if ('defaultStrategy' in team) {
        patch.default_strategy =
          team.defaultStrategy === 'competitive' || team.defaultStrategy === 'development'
            ? team.defaultStrategy
            : null
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabaseAdmin.from('teams').update(patch).eq('id', teamId)
        if (error) throw error
      }
    }

    if (player?.teamPlayerId) {
      const patch: Record<string, any> = {}
      if ('lockedPosition' in player) {
        patch.locked_position = player.lockedPosition || null
      }
      if ('excludedPositions' in player) {
        patch.excluded_positions = Array.isArray(player.excludedPositions)
          ? player.excludedPositions
          : []
      }
      for (const [key, col] of [['minInnings', 'min_innings'], ['maxInnings', 'max_innings']] as const) {
        if (key in player) {
          const n = Number(player[key])
          patch[col] = player[key] == null || player[key] === '' || isNaN(n)
            ? null
            : Math.max(0, Math.round(n))
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await supabaseAdmin
          .from('team_players')
          .update(patch)
          .eq('id', player.teamPlayerId)
          .eq('team_id', teamId)   // a row id from another team is not a match
        if (error) throw error
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Lineup constraints PATCH error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not save that rule' },
      { status: 500 }
    )
  }
}
