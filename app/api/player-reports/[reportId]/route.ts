import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse, AuthzError } from '@/lib/authz'
import {
  cleanText, cleanStrengthAreas, isReportType,
  MAX_FOCUS_AREAS, MAX_DRILLS,
} from '@/lib/playerReports'
import {
  loadFullReport, buildContext, saveFocusAreas, saveDrillSelection,
  refreshDrillSnapshots,
} from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// One report: read it, save the draft, throw the draft away.
//
// WHY PATCH DOES EVERYTHING
//
// Content, priorities and drill selection all arrive in one call. The
// alternative — an endpoint per section — means a coach on a phone in a car
// park makes four requests to save one screen, any of which can be the one
// that fails, and the report ends up in a state that matches nothing they saw.
// One write, one answer, and the response is the whole report as it now
// stands so the wizard never has to guess.
//
// WHY DRAFTS ONLY
//
// A finalized report has been sent to a family. Editing it would mean the PDF
// in somebody's inbox and the report in the app disagree, with the app being
// the one that is wrong. So finalized reports refuse writes here, RLS refuses
// them again in migration 046, and "edit" is a revision — see ./revise.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET — the whole report
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const actor = await authorizeReport(params.reportId, 'read')

    const report = await loadFullReport(supabaseAdmin, params.reportId)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    // A draft reads its header live, so renaming the team is reflected while
    // the coach is still writing. A finalized report uses the copy taken when
    // they finalized, which is the whole point of taking one.
    const context = report.status === 'final' && report.context
      ? report.context
      : await buildContext(supabaseAdmin, {
          teamId: report.team_id,
          playerId: report.player_id,
          coachId: report.coach_id,
        })

    return NextResponse.json({
      report: { ...report, context },
      // Two different questions. canEdit is "may this report be changed right
      // now" — false for everyone once it is finalized. canAuthor is "may this
      // person write reports at all", which is what decides whether they are
      // offered a revision of a finalized one. The routes refuse independently;
      // these only stop a viewer being shown buttons that would refuse them.
      canEdit: report.status === 'draft' && (actor.role === 'owner' || actor.role === 'admin'),
      canAuthor: actor.role === 'owner' || actor.role === 'admin',
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report read error:', error)
    return NextResponse.json({ error: 'Could not load that report.' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH — save the draft
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const { report: row } = await authorizeReport(params.reportId, 'decide')

    if (row.status !== 'draft') {
      throw new AuthzError(
        'This report has been finalized. Start a revision to make changes — the version you already shared stays as it was.',
        409
      )
    }

    let body: any = {}
    try { body = await request.json() } catch { /* an empty PATCH is a no-op */ }

    // Only the fields actually sent are touched. The wizard saves one step at
    // a time, and a step that does not mention the closing comment must not
    // erase it.
    const patch: Record<string, any> = {}
    if ('reportType' in body && isReportType(body.reportType)) patch.report_type = body.reportType
    if ('reportDate' in body) {
      const d = String(body.reportDate || '')
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) patch.report_date = d
    }
    if ('strengthsContent' in body) patch.strengths_content = cleanText(body.strengthsContent)
    if ('developmentIntro' in body) patch.development_intro = cleanText(body.developmentIntro)
    if ('closingContent' in body) patch.closing_content = cleanText(body.closingContent)
    if ('strengthAreas' in body) patch.strength_areas = cleanStrengthAreas(body.strengthAreas)

    if (Object.keys(patch).length) {
      // The status filter is belt to RLS's braces: even if this handler's
      // check above were ever removed, a finalized row cannot be written here.
      const { error } = await supabaseAdmin
        .from('player_reports')
        .update(patch)
        .eq('id', params.reportId)
        .eq('status', 'draft')
      if (error) throw error
    }

    // Priorities before drills, because a drill points at a priority and the
    // ids have to exist before anything can reference them.
    if (Array.isArray(body.focusAreas)) {
      await saveFocusAreas(
        supabaseAdmin,
        params.reportId,
        body.focusAreas.slice(0, MAX_FOCUS_AREAS).map((f: any) => ({
          id: typeof f?.id === 'string' ? f.id : null,
          problemSlug: typeof f?.problemSlug === 'string' ? f.problemSlug : null,
          focusArea: typeof f?.focusArea === 'string' ? f.focusArea : null,
          label: String(f?.label || ''),
          coachNotes: f?.coachNotes,
          approvedContent: f?.approvedContent,
        }))
      )
    }

    if (Array.isArray(body.drills)) {
      const { data: areas } = await supabaseAdmin
        .from('player_report_focus_areas')
        .select('id, label')
        .eq('report_id', params.reportId)
      const validAreaIds = new Map(((areas || []) as any[]).map(a => [a.id, a.label]))

      await saveDrillSelection(supabaseAdmin, {
        reportId: params.reportId,
        coachId: row.team_id ? await ownerCoachFor(row.team_id) : null,
        selection: body.drills.slice(0, MAX_DRILLS).map((d: any) => ({
          drillId: String(d?.drillId || ''),
          focusAreaId: typeof d?.focusAreaId === 'string' ? d.focusAreaId : null,
          includeVideo: d?.includeVideo !== false,
          source: d?.source === 'manual' ? 'manual' : 'recommended',
        })),
        validAreaIds,
      })
    } else if (Array.isArray(body.focusAreas)) {
      // Priorities changed, so the "recommended because" line on drills that
      // reference them is now stale. Cheap to redo, confusing not to.
      await refreshDrillSnapshots(
        supabaseAdmin, params.reportId, await ownerCoachFor(row.team_id)
      )
    }

    const report = await loadFullReport(supabaseAdmin, params.reportId)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const context = await buildContext(supabaseAdmin, {
      teamId: report.team_id, playerId: report.player_id, coachId: report.coach_id,
    })

    return NextResponse.json({ report: { ...report, context } })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report save error:', error)
    return NextResponse.json({ error: 'Could not save that report.' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE — throw away a draft
// ---------------------------------------------------------------------------
// Drafts only. A finalized report may already be in a family's inbox, and an
// app that can make the coach's copy of it vanish is not one anybody should
// trust with the record.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const { report: row } = await authorizeReport(params.reportId, 'decide')

    if (row.status !== 'draft') {
      throw new AuthzError(
        'Finalized reports are kept. You can start a revision, but the version you shared stays in the history.',
        409
      )
    }

    const { error } = await supabaseAdmin
      .from('player_reports')
      .delete()
      .eq('id', params.reportId)
      .eq('status', 'draft')
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report delete error:', error)
    return NextResponse.json({ error: 'Could not delete that draft.' }, { status: 500 })
  }
}

/**
 * Whose drill library applies here.
 *
 * The report belongs to a team, and a team belongs to a coach. Drill
 * visibility is keyed on that coach — the workspace owner — not on whoever is
 * typing, so an assistant editing a draft sees the same library the head coach
 * would. Falls back to the curated library alone if the team has gone.
 */
async function ownerCoachFor(teamId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('teams').select('coach_id').eq('id', teamId).maybeSingle()
  return (data as any)?.coach_id || null
}
