import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse, AuthzError } from '@/lib/authz'
import { isReportSendable } from '@/lib/playerReports'
import {
  loadFullReport, buildContext, refreshDrillSnapshots,
} from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Finalizing: the moment the report stops being editable.
//
// Everything about historical integrity happens in this handler, in this
// order, and the order is the point:
//
//   1. Copy the team, season, age group and coach names onto the row. From
//      here the report says "8U · Fall 2026 · Coach Clint" forever, however
//      many times the team is renamed or the age group rolls over.
//   2. Take a last copy of every selected drill from the live library. After
//      this the snapshots never move again, so a re-curation in 2027 cannot
//      change a document a family received in 2026.
//   3. Flip the status. The API refuses writes from here and so does RLS.
//
// If step 3 fails, 1 and 2 have only refreshed a draft, which is harmless. If
// it succeeds, everything the report will ever print is already frozen.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const { report: row } = await authorizeReport(params.reportId, 'decide')

    if (row.status === 'final') {
      // Not an error worth alarming anyone about — usually a double tap on a
      // slow connection. Hand back the report that already exists.
      const already = await loadFullReport(supabaseAdmin, params.reportId)
      return NextResponse.json({ report: already, alreadyFinal: true })
    }

    const draft = await loadFullReport(supabaseAdmin, params.reportId)
    if (!draft) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    // A report with nothing in it would produce a PDF with a name and a date.
    // Not a hard rule about which sections are required — strengths alone, or
    // one development area alone, is a perfectly good report.
    if (!isReportSendable(draft)) {
      throw new AuthzError(
        'There is nothing in this report yet. Add strengths, a development area, or a closing comment before finalizing.',
        400
      )
    }

    const { data: team } = await supabaseAdmin
      .from('teams').select('coach_id').eq('id', row.team_id).maybeSingle()
    const ownerCoachId = (team as any)?.coach_id || draft.coach_id

    const context = await buildContext(supabaseAdmin, {
      teamId: draft.team_id, playerId: draft.player_id, coachId: ownerCoachId,
    })

    await refreshDrillSnapshots(supabaseAdmin, params.reportId, ownerCoachId)

    const { error } = await supabaseAdmin
      .from('player_reports')
      .update({
        context,
        status: 'final',
        finalized_at: new Date().toISOString(),
      })
      .eq('id', params.reportId)
      // Two coaches finalizing the same draft at once: the second update
      // matches nothing rather than re-stamping finalized_at on a report that
      // has already gone out.
      .eq('status', 'draft')
    if (error) throw error

    const report = await loadFullReport(supabaseAdmin, params.reportId)
    return NextResponse.json({ report, alreadyFinal: false })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report finalize error:', error)
    // The draft is untouched. Say so — a coach who has just spent twenty
    // minutes on this needs to know nothing was lost.
    return NextResponse.json(
      { error: 'Could not finalize that report. Your draft is still saved — try again in a moment.' },
      { status: 500 }
    )
  }
}
