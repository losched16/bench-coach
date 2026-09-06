import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse } from '@/lib/authz'
import { gatherSources } from '@/lib/playerReportSourcesStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// "What have I already recorded about this player?"
//
// Read-only. Returns the coach's own notes, priorities, observations, entries,
// measurements and traits for the report's player, dated and grouped, so the
// wizard can offer them as a starting point instead of a blank page.
//
// Authorized like the report itself: report → team → the caller's role. A
// viewer may read it (they may read the report); the picker only appears to
// someone who may write. Nothing here writes anything.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const { report } = await authorizeReport(params.reportId, 'read')

    // The workspace owner's records, not the caller's: an assistant coach
    // reading this sees what the head coach's team has recorded, which is
    // what the report is being written from.
    const { data: team } = await supabaseAdmin
      .from('teams').select('coach_id').eq('id', report.team_id).maybeSingle()
    const coachId = (team as any)?.coach_id
    if (!coachId) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const allSeasons = new URL(request.url).searchParams.get('all') === '1'

    const bundle = await gatherSources(supabaseAdmin, {
      teamId: report.team_id,
      playerId: report.player_id,
      coachId,
      allSeasons,
    })

    return NextResponse.json(bundle)
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report sources error:', error)
    return NextResponse.json(
      { error: 'Could not load what has been recorded for this player.' },
      { status: 500 }
    )
  }
}
