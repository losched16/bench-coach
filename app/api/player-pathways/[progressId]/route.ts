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

    // EVERY stage's drills, not just the one the player is standing on.
    //
    // The plan is a course, not a gate. A coach reading ahead to decide whether
    // a kid is ready for stage 6, or a parent helper who wants to see where
    // this is going, should not have to advance a child to find out what is in
    // it. Nothing here is hidden behind progress.
    //
    // Sent as a drill POOL plus per-stage references rather than a drill object
    // per slot: the speed pathway has 44 slots pointing at 33 distinct drills,
    // and the instruction text is long enough that duplicating it would be the
    // difference between a page that loads at a field and one that does not.
    //
    // Still the SAME recommender the practice planner uses, once per stage. Not
    // a second recommendation system — a player page that ranked drills
    // differently from the practice plan would be the product disagreeing with
    // itself in front of a coach.
    let drillPool: Record<string, any> = {}
    let stageDrills: Record<string, Array<{ id: string; role: string; step: string; rationale: string }>> = {}
    let stageMissing = false

    if (pathway) {
      const stages = orderedStages(pathway)
      stageMissing = !stages.some(s => s.stage_key === (row as any).current_stage_key)

      const { data: pool } = await visibleDrills(supabaseAdmin, null, '*')
      const byId = new Map(((pool || []) as any[]).map(d => [d.id, d]))

      // One pass per stage, over one in-memory pool. No feasibility constraints
      // are passed: a player page is not a practice being built today, and
      // narrowing by a field size nobody has entered would hide drills for no
      // reason. The practice planner applies those when it schedules.
      const perStage = stages.map(s => ({
        stage: s,
        recommended: getPathwayPracticeRecommendation({
          pathway, currentStage: s.stage_number, pool: (pool || []) as any[],
        })?.recommended || [],
      }))

      const needed = Array.from(new Set(perStage.flatMap(p => p.recommended.map(d => d.drillId))))

      // MEDIA, THROUGH THE EXISTING SYSTEM AND NOTHING ELSE.
      //
      // No URL is constructed here and no timestamp is invented. lib/drillMedia
      // reads drill_media_resources, falls back to the legacy youtube_* columns
      // for drills the backfill never touched, drops anything 'rejected', and
      // ranks verified above unverified — the same path Player Reports, the
      // practice sheet and the Drill Finder take, so a coach cannot be shown
      // one thing here and another there.
      //
      // loadAllMedia pulls the whole table because "is this a compilation?" is
      // not a property of one drill's row, it is a property of the table.
      // describeMedia then turns the answer into words that do not overclaim.
      const [mediaByDrill, allMedia] = await Promise.all([
        loadMediaFor(supabaseAdmin, needed),
        loadAllMedia(supabaseAdmin),
      ])
      const shareCounts = sharedVideoCounts(allMedia)

      for (const id of needed) {
        const full = byId.get(id) || {}
        const playable = mediaForDrill({ ...full, id } as any, mediaByDrill.get(id))
        drillPool[id] = {
          id,
          drill_name: full.drill_name ?? null,
          est_duration_minutes: full.est_duration_minutes ?? null,
          equipment_needed: full.equipment_needed ?? null,
          space_required: full.space_required ?? null,
          indoor_outdoor: full.indoor_outdoor ?? null,
          requires_partner: full.requires_partner ?? null,
          min_players: full.min_players ?? null,
          ideal_group_size: full.ideal_group_size ?? null,
          age_range: full.age_range ?? null,
          difficulty_level: full.difficulty_level ?? null,
          reps_guidance: full.reps_guidance ?? null,
          // The fields that make a drill runnable by a coach who has never
          // seen it, and which this page was fetching and throwing away.
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
      }

      for (const { stage, recommended } of perStage) {
        stageDrills[stage.stage_key] = recommended.map(d => ({
          id: d.drillId, role: d.role, step: d.step, rationale: d.rationale,
        }))
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
            // How many drills each stage offers, keyed by stage_key, so the
            // plan overview can say what is coming without a second request
            // per stage. Already in memory — loadPathway fetched every link.
            drillCounts: orderedStages(pathway).reduce((acc, s) => {
              acc[s.stage_key] = (pathway.linksByStage.get(s.id) || []).length
              return acc
            }, {} as Record<string, number>),
          }
        : null,
      drillPool,
      stageDrills,
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
