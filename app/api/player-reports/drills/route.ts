import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse } from '@/lib/authz'
import { retrieveDrills, type ScoredDrill } from '@/lib/drillRetrieval'
import { loadTaxonomy, type Diagnosis } from '@/lib/drillDiagnosis'
import { drillSnapshot, recommendationReason } from '@/lib/playerReports'
import { loadFullReport, playerAge, searchLibraryByName } from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Drills for a development priority.
//
// EVERY DRILL HERE IS A ROW IN THE LIBRARY
//
// This route retrieves. It does not generate. It calls the same
// retrieveDrills() that Chat uses — lib/drillRetrieval.ts, the engine that was
// already on main — and hands it a diagnosis built from the problem the coach
// chose. Taxonomy mapping outranks text, the operational filters (age,
// competition level) apply only when known, and the ordering is deterministic
// down to the drill id. Nothing in the pipeline can name a drill that does not
// exist.
//
// WHY NO MODEL CALL ON THE COMMON PATH
//
// The coach has already told us the problem: it is a problem_taxonomy slug
// they picked from a list. retrieveDrills() would normally ask a model to read
// a free-text complaint into slugs, but a slug is the ANSWER to that question,
// so it is passed straight in as the diagnosis and the model is never asked.
// Two coaches choosing "Fields flat-footed" get the same drills in the same
// order, which is what a recommendation a family will act on should do. The
// model path survives for a priority the coach typed themselves.
//
// WHY THREE TO FIVE
//
// A coach reviewing suggestions for their own player is doing a judgement
// task, and twenty results is not more choice — it is the same choice made
// worse. Enough to disagree with, few enough to actually read.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

const DEFAULT_WANT = 4
const MAX_WANT = 5

export async function POST(request: NextRequest) {
  let body: any = {}
  try { body = await request.json() } catch { /* refused below */ }

  try {
    // 'decide', not 'read': asking for recommendations is part of authoring a
    // report, and only the people who may author one should be able to spend
    // a retrieval (and, on the typed-label path, a model call) from the app.
    await authorizeReport(body?.reportId, 'decide')

    const report = await loadFullReport(supabaseAdmin, String(body.reportId))
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const { data: team } = await supabaseAdmin
      .from('teams').select('coach_id, season_id').eq('id', report.team_id).maybeSingle()
    const coachId = (team as any)?.coach_id || report.coach_id

    // Never suggest something the coach has already put in this report.
    const already = new Set(report.drills.map(d => d.drill_id).filter(Boolean) as string[])

    // ---- Manual search --------------------------------------------------
    // The coach has decided our suggestions are wrong and wants the drill they
    // had in mind, by name.
    if (typeof body.query === 'string' && body.query.trim()) {
      const found = await searchLibraryByName(supabaseAdmin, coachId, body.query, 20)
      return NextResponse.json({
        drills: found.filter(d => !already.has(d.id)).map(d => presentable(d, null)),
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
    // label. This is the text-scoring surface; the slug does the precise work.
    const query = [area.coach_notes, area.approved_content, area.label]
      .filter(Boolean).join(' ')

    // Loaded once here and handed in, so retrieveDrills() does not read it a
    // second time for its age caveats.
    const taxonomy = await loadTaxonomy(supabaseAdmin)
    const chosen = area.problem_slug
      ? taxonomy.find(t => t.slug === area.problem_slug) || null
      : null

    // A catalogued problem IS the diagnosis. 'aliases' is the engine's name
    // for "reached without a model call", which is exactly what this is.
    const diagnosis: Diagnosis | undefined = chosen
      ? { slugs: [chosen.slug], categories: chosen.skill_category ? [chosen.skill_category] : [], via: 'aliases' }
      : undefined

    const result = await retrieveDrills({
      supabase: supabaseAdmin,
      coachId,
      query,
      diagnosis,
      taxonomy,
      playerAge: await playerAge(supabaseAdmin, report.player_id),
      competitionLevel: await competitionLevelFor((team as any)?.season_id),
      // Room to drop what is already in the report and still fill the menu.
      limit: want + already.size + 4,
    })

    const fresh = result.scored.filter(s => !already.has(s.drill.id)).slice(0, want)

    if (fresh.length === 0) {
      // No fallback drills are invented. An empty library for this problem is
      // a real answer, and the coach can search for what they had in mind.
      return NextResponse.json({
        drills: [],
        exhausted: true,
        message:
          'No drills in the library match that one yet. Search for a drill by name, ' +
          'or leave the drills out — the development area still stands on its own.',
        mode: 'recommend',
        notes: result.debug.ageCaveats,
      })
    }

    return NextResponse.json({
      drills: fresh.map(s => presentable(s.drill, area.label, s)),
      mode: 'recommend',
      // "That is normal at seven" is worth saying to a coach before they put a
      // drill for it in front of a family. Comes from the taxonomy, not a model.
      notes: result.debug.ageCaveats,
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
 * The season's league type, as the retrieval engine's competition filter.
 *
 * seasons.league_type is rec | travel | clinic | other. Only the first two
 * mean anything to a drill's competition_level; a clinic is neither, and
 * passing it would exclude every drill scoped to either. Unknown is not a
 * constraint.
 */
async function competitionLevelFor(seasonId: string | null | undefined): Promise<string | null> {
  if (!seasonId) return null
  const { data } = await supabaseAdmin
    .from('seasons').select('league_type').eq('id', seasonId).maybeSingle()
  const t = String((data as any)?.league_type || '').toLowerCase()
  return t === 'rec' || t === 'travel' ? t : null
}

/**
 * A candidate as the wizard needs it: the snapshot the report would store,
 * plus the id and the video fields the preview card renders.
 *
 * The snapshot is built here so what the coach previews is byte-for-byte what
 * gets saved — the same drillSnapshot() the save path calls. The inline
 * preview's start time is taken from that snapshot rather than the raw row,
 * so the preview honours the same provenance gate the document does.
 */
function presentable(drill: any, focusLabel: string | null, scored?: ScoredDrill) {
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
    youtubeStartSeconds: snapshot.video_start_seconds,
    skillCategory: drill.skill_category || null,
    equipment: Array.isArray(drill.equipment_needed) ? drill.equipment_needed : [],
    isCoachDrill: Boolean(drill.created_by_coach_id),
    // How the engine chose it, for anyone debugging a bad suggestion.
    retrieval: scored ? { primary: scored.reason.primary, curated: scored.reason.curated } : null,
  }
}
