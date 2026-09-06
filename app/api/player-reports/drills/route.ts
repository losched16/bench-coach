import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse } from '@/lib/authz'
import { gatherCandidates, rankByFit, searchLibrary } from '@/lib/drillRetrieval'
import { drillSnapshot, recommendationReason } from '@/lib/playerReports'
import { loadFullReport, playerAge } from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Drills for a development priority.
//
// EVERY DRILL HERE IS A ROW IN THE LIBRARY
//
// This route retrieves. It does not generate. The pipeline is the one the
// prescription engine already uses — lib/drillRetrieval.ts, shared rather than
// reimplemented — and the only model call in it picks numbers out of a list of
// real drills it was handed. It cannot name a drill that does not exist, and
// an index outside the list is discarded.
//
// That is not a stylistic preference about AI. It is the reason a coach can
// put these in front of a family: the drill has a name because a human wrote
// it down, and the video link is the one stored on that row.
//
// WHY THREE TO FIVE
//
// A coach reviewing suggestions for their own player is doing a judgement task,
// and twenty results is not more choice — it is the same choice made worse.
// Enough to disagree with, few enough to actually read.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// The ranking step is one small model call; the rest is database work.
export const maxDuration = 60

const DEFAULT_WANT = 4
const MAX_WANT = 5

export async function POST(request: NextRequest) {
  let body: any = {}
  try { body = await request.json() } catch { /* refused below */ }

  try {
    // 'decide', not 'read': asking for recommendations is part of authoring a
    // report, and only the people who may author one should be able to spend
    // a model call from the app.
    await authorizeReport(body?.reportId, 'decide')

    const report = await loadFullReport(supabaseAdmin, String(body.reportId))
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const { data: team } = await supabaseAdmin
      .from('teams').select('coach_id').eq('id', report.team_id).maybeSingle()
    const coachId = (team as any)?.coach_id || report.coach_id

    // Never suggest something the coach has already put in this report.
    const already = new Set(report.drills.map(d => d.drill_id).filter(Boolean) as string[])

    // ---- Manual search --------------------------------------------------
    // The coach has decided our suggestions are wrong and wants the drill they
    // had in mind. Server-side, because 206 drills with coaching notes is not
    // a payload a phone on a car-park connection should download to filter.
    if (typeof body.query === 'string' && body.query.trim()) {
      const found = await searchLibrary(supabaseAdmin, coachId, body.query, 20)
      return NextResponse.json({
        drills: found
          .filter(d => !already.has(d.id))
          .map(d => presentable(d, null)),
        mode: 'search',
      })
    }

    // ---- Recommendations for one priority -------------------------------
    const areaId = typeof body.focusAreaId === 'string' ? body.focusAreaId : null
    const area = report.focusAreas.find(f => f.id === areaId) || null

    if (!area) {
      return NextResponse.json(
        { error: 'Pick a development area first, or search the library.' },
        { status: 400 }
      )
    }

    const want = Math.min(Number(body.count) > 0 ? Number(body.count) : DEFAULT_WANT, MAX_WANT)

    // What the coach actually said, in priority order: their own notes are the
    // truest description of the problem, then the approved wording, then the
    // label. The taxonomy slug does the precise work; this bounds the pool
    // when there is no slug or the mapping is thin.
    const searchText = [area.coach_notes, area.approved_content, area.label]
      .filter(Boolean).join(' ')

    const pool = await gatherCandidates(supabaseAdmin, {
      problemSlug: area.problem_slug,
      exclude: already,
      playerAge: await playerAge(supabaseAdmin, report.player_id),
      searchText,
      coachId,
    })

    if (pool.length === 0) {
      // No fallback drills are invented. An empty library for this problem is
      // a real answer, and the coach can search for what they had in mind.
      return NextResponse.json({
        drills: [],
        exhausted: true,
        message:
          'No drills in the library match that one yet. Search for a drill by name, ' +
          'or leave the drills out — the development area still stands on its own.',
        mode: 'recommend',
      })
    }

    const ranked = await rankByFit(searchText, undefined, pool, want)
    const chosen = (ranked.length ? ranked : pool.slice(0, want)).slice(0, want)

    return NextResponse.json({
      drills: chosen.map(d => presentable(d, area.label)),
      mode: 'recommend',
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report drill recommendation error:', error)
    return NextResponse.json(
      {
        drills: [],
        error: 'Could not fetch drill suggestions right now. You can still search the library by name.',
      },
      { status: 200 }
    )
  }
}

/**
 * A candidate as the wizard needs it: the snapshot the report would store,
 * plus the id and the video fields the preview card renders.
 *
 * The snapshot is built here so what the coach previews is byte-for-byte what
 * gets saved — the same drillSnapshot() the save path calls.
 */
function presentable(drill: any, focusLabel: string | null) {
  const snapshot = drillSnapshot(drill)
  return {
    id: drill.id,
    snapshot,
    recommendationReason: recommendationReason(focusLabel, snapshot),
    // For the inline video preview, which uses the existing DrillVideo
    // component and therefore wants the raw fields rather than the snapshot.
    youtubeVideoId: drill.youtube_video_id || null,
    youtubeUrl: drill.youtube_url || null,
    thumbnailUrl: drill.thumbnail_url || null,
    youtubeStartSeconds: drill.youtube_start_seconds ?? null,
    skillCategory: drill.skill_category || null,
    equipment: Array.isArray(drill.equipment_needed) ? drill.equipment_needed : [],
    isCoachDrill: Boolean(drill.created_by_coach_id),
  }
}
