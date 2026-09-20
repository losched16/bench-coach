import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse } from '@/lib/authz'
import { loadPathway, orderedStages } from '@/lib/developmentPathways'
import { migrationHintFor } from '@/lib/migrationHints'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request.
export const dynamic = 'force-dynamic'

// A player's development plans: listing them, and starting one.
//
// TWO DIFFERENT PERMISSIONS, DELIBERATELY
//
// Reading is 'read' — any member of the team, viewer included. The same
// position player_notes and player_reports take: what the staff has recorded
// about a player is visible to the staff.
//
// Enrolling is 'decide' — admin and above, NOT 'record'. lib/authz.ts draws the
// line at "write down what happened" versus "decide what happens next", and
// putting a child on a twelve-week curriculum is squarely the second. A parent
// helper keeping the book does not choose what a kid is taught next.
//
// The database agrees: migration 072's INSERT policy requires 'admin'. Both
// enforcement points, one model — which is the whole reason lib/authz.ts exists.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET ?teamId=&playerId=  — the Development section of a player profile
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')
  const playerId = searchParams.get('playerId')

  try {
    await authorizeTeam(teamId, 'read')
    if (!playerId) return NextResponse.json({ error: 'playerId is required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('player_pathway_progress')
      .select('*, pathway:development_pathways(slug, name, skill_category, summary)')
      .eq('team_id', teamId as string)
      .eq('player_id', playerId)
      .order('status', { ascending: true })       // active and paused before completed
      .order('started_at', { ascending: false })
    if (error) throw error

    const rows = data || []

    // Session counts, so the profile card can say "6 sessions" without the
    // client fetching every event for every plan.
    const ids = rows.map((r: any) => r.id)
    const counts = new Map<string, number>()
    const atStage = new Map<string, number>()
    if (ids.length) {
      const { data: evs } = await supabaseAdmin
        .from('player_pathway_events')
        .select('progress_id, stage_key')
        .in('progress_id', ids)
        .eq('event_type', 'session_logged')
      for (const e of (evs || []) as any[]) {
        counts.set(e.progress_id, (counts.get(e.progress_id) || 0) + 1)
        const row = rows.find((r: any) => r.id === e.progress_id)
        if (row && e.stage_key === row.current_stage_key) {
          atStage.set(e.progress_id, (atStage.get(e.progress_id) || 0) + 1)
        }
      }
    }

    // Stage totals per pathway, so "Stage 3 of 10" is a fact and not a guess.
    const totals = new Map<string, number>()
    const pathwayIds = Array.from(new Set(rows.map((r: any) => r.pathway_id)))
    if (pathwayIds.length) {
      const { data: stages } = await supabaseAdmin
        .from('development_pathway_stages').select('pathway_id').in('pathway_id', pathwayIds)
      for (const s of (stages || []) as any[]) {
        totals.set(s.pathway_id, (totals.get(s.pathway_id) || 0) + 1)
      }
    }

    return NextResponse.json({
      pathways: rows.map((r: any) => ({
        ...r,
        stage_total: totals.get(r.pathway_id) || 0,
        sessions_total: counts.get(r.id) || 0,
        sessions_at_stage: atStage.get(r.id) || 0,
      })),
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    // Migration 072 may not be applied. A player profile that 500s because a
    // new table is missing is worse than one that shows no plans and says why.
    const hint = migrationHintFor(error)
    console.error('Player pathways list error:', error)
    return NextResponse.json({
      pathways: [],
      needsMigration: true,
      migrationMessage: hint?.message || 'Development plans are not set up on this database yet.',
    })
  }
}

// ---------------------------------------------------------------------------
// POST { teamId, playerId, pathwaySlug }  — start a development plan
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: any = {}
  try { body = await request.json() } catch { /* handled below */ }

  try {
    const actor = await authorizeTeam(body?.teamId, 'decide')
    const teamId = String(body.teamId)
    const playerId = String(body.playerId || '')
    const slug = String(body.pathwaySlug || '')

    if (!playerId) return NextResponse.json({ error: 'playerId is required' }, { status: 400 })
    if (!slug) return NextResponse.json({ error: 'pathwaySlug is required' }, { status: 400 })

    // The player must be on THIS team. Without this a caller who administers
    // any team could enroll any player in the database, because the team check
    // above only proves they administer the team they named.
    const { data: onTeam } = await supabaseAdmin
      .from('team_players').select('id')
      .eq('team_id', teamId).eq('player_id', playerId).maybeSingle()
    if (!onTeam) return NextResponse.json({ error: 'That player is not on this team' }, { status: 404 })

    const pathway = await loadPathway(supabaseAdmin, slug)
    if (!pathway) return NextResponse.json({ error: 'That pathway does not exist' }, { status: 404 })
    if (pathway.pathway.status !== 'published') {
      return NextResponse.json({ error: 'That pathway is not published' }, { status: 400 })
    }

    const stages = orderedStages(pathway)
    const first = stages[0]
    if (!first) {
      return NextResponse.json({ error: 'That pathway has no stages yet' }, { status: 400 })
    }

    // Already on it? Say so rather than racing the unique index — the coach
    // most likely wants the plan they already have.
    const { data: live } = await supabaseAdmin
      .from('player_pathway_progress').select('id')
      .eq('player_id', playerId).eq('team_id', teamId)
      .eq('pathway_id', pathway.pathway.id).neq('status', 'completed').maybeSingle()
    if (live) {
      return NextResponse.json({ progressId: (live as any).id, alreadyEnrolled: true })
    }

    const { data: created, error: insErr } = await supabaseAdmin
      .from('player_pathway_progress')
      .insert({
        player_id: playerId,
        team_id: teamId,
        pathway_id: pathway.pathway.id,
        // Pinned at enrollment and never updated. If the pathway becomes v2
        // and renumbers, this row still says which sequence was taught.
        pathway_version: (pathway.pathway as any).version ?? 1,
        current_stage_key: first.stage_key,
        current_stage_number: first.stage_number,
        status: 'active',
        created_by: actor.userId,
      })
      .select('id')
      .single()
    if (insErr) throw insErr

    const progressId = (created as any).id

    await supabaseAdmin.from('player_pathway_events').insert({
      progress_id: progressId,
      team_id: teamId,           // overwritten by the trigger; sent for clarity
      event_type: 'enrolled',
      stage_key: first.stage_key,
      stage_number: first.stage_number,
      actor_user_id: actor.userId,
    })

    return NextResponse.json({ progressId, stageKey: first.stage_key })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    const hint = migrationHintFor(error)
    if (hint) return NextResponse.json({ error: hint.message }, { status: 503 })

    console.error('Player pathway enroll error:', error)
    return NextResponse.json({ error: 'Could not start that plan' }, { status: 500 })
  }
}
