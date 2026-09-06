import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse, AuthzError } from '@/lib/authz'
import { loadFullReport } from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// "I need to change something I already sent."
//
// The version the family has stays exactly as it is, and a new draft opens as
// a copy of it. That is the whole versioning strategy: no in-place edits, no
// soft-delete of the old one, no "final v2" status. The player's history shows
// both, marked Revision 1 and Revision 2, and the coach can say which one they
// sent.
//
// The alternative — letting a finalized report be edited — means the PDF in a
// parent's inbox and the report in the app can disagree with no record that
// they ever differed. That is worse than a slightly longer history list.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const actor = await authorizeReport(params.reportId, 'decide')

    const source = await loadFullReport(supabaseAdmin, params.reportId)
    if (!source) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    if (source.status !== 'final') {
      throw new AuthzError('That report is still a draft — open it and keep editing.', 409)
    }

    // One open revision at a time. Otherwise "Make changes" tapped twice on a
    // slow connection produces two drafts of the same report and no way to
    // tell which one is being edited.
    const { data: openDraft } = await supabaseAdmin
      .from('player_reports')
      .select('id')
      .eq('team_id', source.team_id)
      .eq('player_id', source.player_id)
      .eq('status', 'draft')
      .limit(1)
      .maybeSingle()

    if ((openDraft as any)?.id) {
      return NextResponse.json({ report: openDraft, resumed: true })
    }

    const { data: created, error } = await supabaseAdmin
      .from('player_reports')
      .insert({
        team_id: source.team_id,
        player_id: source.player_id,
        coach_id: source.coach_id,
        author_user_id: actor.userId,
        report_type: source.report_type,
        status: 'draft',
        // Today's date, not the original's. This is a new document with a new
        // date on it, which is what a family needs to be able to tell them
        // apart.
        report_date: new Date().toISOString().slice(0, 10),
        strengths_content: source.strengths_content,
        development_intro: source.development_intro,
        closing_content: source.closing_content,
        strength_areas: source.strength_areas,
        revision_of: source.id,
        revision: (source.revision || 1) + 1,
      })
      .select('id')
      .single()

    if (error) throw error
    const newId = (created as any).id as string

    // Priorities first, keeping their order, and remembering which new row
    // each old one became so the drills can be re-pointed at the right one.
    const areaMap = new Map<string, string>()
    for (const area of source.focusAreas) {
      const { data: copy } = await supabaseAdmin
        .from('player_report_focus_areas')
        .insert({
          report_id: newId,
          problem_slug: area.problem_slug,
          focus_area: area.focus_area,
          label: area.label,
          coach_notes: area.coach_notes,
          approved_content: area.approved_content,
          sort_order: area.sort_order,
        })
        .select('id')
        .maybeSingle()
      if ((copy as any)?.id) areaMap.set(area.id, (copy as any).id)
    }

    // The snapshots are copied as they were rather than re-read from the
    // library. A revision starts as an exact copy of what was sent; the next
    // draft save refreshes them, which is the point at which the coach is
    // looking at the report and can see what changed.
    for (const drill of source.drills) {
      await supabaseAdmin.from('player_report_drills').insert({
        report_id: newId,
        focus_area_id: drill.focus_area_id ? areaMap.get(drill.focus_area_id) || null : null,
        drill_id: drill.drill_id,
        snapshot: drill.snapshot,
        recommendation_reason: drill.recommendation_reason,
        source: drill.source,
        include_video: drill.include_video,
        sort_order: drill.sort_order,
      })
    }

    return NextResponse.json({ report: { id: newId }, resumed: false })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report revise error:', error)
    return NextResponse.json(
      { error: 'Could not start a revision. The report you finalized is unchanged.' },
      { status: 500 }
    )
  }
}
