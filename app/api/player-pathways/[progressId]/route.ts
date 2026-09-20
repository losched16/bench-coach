import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeProgress, authzResponse } from '@/lib/authz'
import { loadPathway, orderedStages, getPathwayPracticeRecommendation } from '@/lib/developmentPathways'
import { visibleDrills } from '@/lib/drills'
import { loadMediaFor, loadAllMedia, mediaForDrill, sharedVideoCounts, sharedCountFor } from '@/lib/drillMedia'
import { describeMedia } from '@/lib/drillFinder'
import { migrationHintFor } from '@/lib/migrationHints'

export const dynamic = 'force-dynamic'

// One development plan, everything the detail page renders.
//
// The team is read from the ENROLLMENT ROW, not from the query string, and the
// authorization check is run against that. A caller who passes their own teamId
// alongside somebody else's progressId would otherwise be checked against a
// team they legitimately administer while reading a row belonging to another.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: { progressId: string } }
) {
  try {
    // Resolves the plan, checks the caller is signed in BEFORE looking it up,
    // and authorizes against the team on the ROW rather than anything the
    // request supplied. 404 rather than 403 throughout, so a probe cannot use
    // the status code as an existence check.
    await authorizeProgress(params.progressId, 'read')

    const { data: row, error } = await supabaseAdmin
      .from('player_pathway_progress')
      .select('*, pathway:development_pathways(slug, name, skill_category, summary, applicability, version)')
      .eq('id', params.progressId)
      .maybeSingle()
    if (error) throw error
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [{ data: player }, { data: events }] = await Promise.all([
      supabaseAdmin.from('players').select('id, name').eq('id', (row as any).player_id).maybeSingle(),
      supabaseAdmin.from('player_pathway_events').select('*')
        .eq('progress_id', params.progressId)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    const slug = (row as any).pathway?.slug
    const pathway = slug ? await loadPathway(supabaseAdmin, slug) : null

    // This stage's drills, through the SAME recommender the practice planner
    // uses. Not a second recommendation system — the brief forbids one, and a
    // player page that ranked drills differently from the practice plan would
    // be the product disagreeing with itself in front of a coach.
    let drills: any[] = []
    let stageMissing = false
    if (pathway) {
      const stages = orderedStages(pathway)
      const stage = stages.find(s => s.stage_key === (row as any).current_stage_key)
      if (!stage) {
        stageMissing = true
      } else {
        const { data: pool } = await visibleDrills(supabaseAdmin, null, '*')
        const byId = new Map(((pool || []) as any[]).map(d => [d.id, d]))
        // No feasibility constraints passed. A player page is not a practice
        // being built today — the coach is reading what this stage is FOR, and
        // narrowing it by a field size nobody has entered would hide drills for
        // no reason. The practice planner applies those when it schedules.
        const rec = getPathwayPracticeRecommendation({
          pathway,
          currentStage: stage.stage_number,
          pool: (pool || []) as any[],
        })
        const recommended = rec?.recommended || []

        // MEDIA, THROUGH THE EXISTING SYSTEM AND NOTHING ELSE.
        //
        // No URL is constructed here and no timestamp is invented. lib/drillMedia
        // reads drill_media_resources, falls back to the legacy youtube_* columns
        // for drills the backfill never touched, drops anything 'rejected', and
        // ranks verified above unverified. That is the same path Player Reports,
        // the practice sheet and the Drill Finder take, so a coach cannot be
        // shown one thing here and another there.
        //
        // loadAllMedia pulls the whole table (~219 rows) because "is this a
        // compilation?" is not a property of one drill's row — it is a property
        // of the table. Without it this surface would have to either guess or
        // promise, and describeMedia is what turns the answer into words that
        // do not overclaim: a shared video with no timestamp is offered as
        // "Source video · covers N drills from this library", never as
        // "watch this drill".
        const [mediaByDrill, allMedia] = await Promise.all([
          loadMediaFor(supabaseAdmin, recommended.map(d => d.drillId)),
          loadAllMedia(supabaseAdmin),
        ])
        const shareCounts = sharedVideoCounts(allMedia)

        drills = recommended.map(d => {
          const full = byId.get(d.drillId) || {}
          const playable = mediaForDrill(
            { ...full, id: d.drillId } as any, mediaByDrill.get(d.drillId))

          return {
            id: d.drillId,
            drill_name: d.drillName,
            role: d.role,
            step: d.step,
            rationale: d.rationale,
            est_duration_minutes: d.estimatedMinutes,
            equipment_needed: full.equipment_needed ?? null,
            space_required: full.space_required ?? null,
            indoor_outdoor: full.indoor_outdoor ?? null,
            requires_partner: full.requires_partner ?? null,
            min_players: full.min_players ?? null,
            ideal_group_size: full.ideal_group_size ?? null,
            age_range: full.age_range ?? null,
            difficulty_level: full.difficulty_level ?? null,
            reps_guidance: full.reps_guidance ?? null,
            // The four fields that make a drill runnable by a coach who has
            // never seen it, and which this page was fetching and throwing away.
            description: full.description ?? null,
            ai_coaching_notes: full.ai_coaching_notes ?? null,
            regression_notes: full.regression_notes ?? null,
            progression_notes: full.progression_notes ?? null,
            success_markers: full.success_markers ?? null,
            common_flaws_fixed: full.common_flaws_fixed ?? null,
            safety_notes: full.safety_notes ?? null,
            media: playable.map(m => ({
              ...m,
              // Computed server-side so the client cannot accidentally render a
              // compilation as though it were a demonstration of this drill.
              presentation: describeMedia(m, sharedCountFor(m, shareCounts)),
              shared_with: sharedCountFor(m, shareCounts),
            })),
          }
        })
      }
    }

    return NextResponse.json({
      progress: row,
      player: player || null,
      events: events || [],
      pathway: pathway
        ? {
            slug: pathway.pathway.slug,
            name: pathway.pathway.name,
            skill_category: pathway.pathway.skill_category,
            stages: orderedStages(pathway),
          }
        : null,
      drills,
      stageMissing,
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    const hint = migrationHintFor(error)
    if (hint) return NextResponse.json({ error: hint.message }, { status: 503 })

    console.error('Player pathway detail error:', error)
    return NextResponse.json({ error: 'Could not load that plan' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a plan started by mistake
// ---------------------------------------------------------------------------
// 'decide', and it takes the history with it, which is why it is only for a
// plan started in error. A plan a player has actually worked is ended by
// completing or pausing it, not by deleting the record that they did the work.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { progressId: string } }
) {
  try {
    await authorizeProgress(params.progressId, 'decide')

    const { error } = await supabaseAdmin
      .from('player_pathway_progress').delete().eq('id', params.progressId)
    if (error) throw error

    return NextResponse.json({ deleted: true })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player pathway delete error:', error)
    return NextResponse.json({ error: 'Could not remove that plan' }, { status: 500 })
  }
}
