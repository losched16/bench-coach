import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse } from '@/lib/authz'
import { isReportType } from '@/lib/playerReports'
import { buildContext, playerIsOnTeam } from '@/lib/playerReportStore'
import { migrationHintFor } from '@/lib/migrationHints'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// The list of a player's reports, and starting a new one.
//
// TWO DIFFERENT PERMISSIONS, DELIBERATELY
//
// Reading is 'read' — any member of the team, including a viewer. That matches
// player_notes: what the coaching staff has written about a player is visible
// to the coaching staff.
//
// Writing is 'decide' — admin and above. It is NOT 'record'. The line this
// codebase draws is between writing down what happened tonight and deciding
// what happens next, and a contributor sits firmly on the first side: a parent
// keeping the book records that a kid struck out. A development document about
// a child, going to that child's family under the head coach's name, is not a
// record of tonight. It is the season's judgement, and it belongs to the
// people who own the team.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET ?teamId=&playerId=  — the report history shown on a player's profile
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')
  const playerId = searchParams.get('playerId')

  try {
    await authorizeTeam(teamId, 'read')

    let q = supabaseAdmin
      .from('player_reports')
      .select('id, player_id, report_type, status, report_date, revision, revision_of, created_at, updated_at, finalized_at, context')
      .eq('team_id', teamId as string)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (playerId) q = q.eq('player_id', playerId)

    const { data, error } = await q
    if (error) throw error

    return NextResponse.json({ reports: data || [] })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    // Migration 054 may not have been applied. A player profile that 500s
    // because a new table is missing is worse than one that shows no reports
    // and says why.
    const hint = migrationHintFor(error)
    console.error('Player reports list error:', error)
    return NextResponse.json({
      reports: [],
      needsMigration: true,
      migrationMessage: hint?.message || 'Player reports are not set up on this database yet.',
    })
  }
}

// ---------------------------------------------------------------------------
// POST { teamId, playerId, reportType? }  — start (or resume) a draft
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: any = {}
  try { body = await request.json() } catch { /* handled by the guard below */ }

  try {
    const actor = await authorizeTeam(body?.teamId, 'decide')
    const teamId = String(body.teamId)
    const playerId = String(body.playerId || '')

    if (!playerId) {
      return NextResponse.json({ error: 'playerId is required' }, { status: 400 })
    }

    // The team is what authorization was granted against. Without this check a
    // coach who legitimately owns their own team could name ANY player id and
    // open a report on a child from another club — the id is the only thing
    // standing between the two, and ids are guessable in principle and
    // copy-pasteable in practice.
    if (!(await playerIsOnTeam(supabaseAdmin, teamId, playerId))) {
      // 404 rather than 403, like everything else here: a 403 confirms the id
      // names a real player somewhere.
      return NextResponse.json({ error: 'Player not found on this team' }, { status: 404 })
    }

    // One open draft per player at a time. Without this, tapping "Create
    // report" twice — which is exactly what a phone on a patchy connection
    // produces — leaves two half-written reports and no way to tell which one
    // the coach was in.
    const { data: openDraft } = await supabaseAdmin
      .from('player_reports')
      .select('id')
      .eq('team_id', teamId)
      .eq('player_id', playerId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if ((openDraft as any)?.id) {
      return NextResponse.json({ report: openDraft, resumed: true })
    }

    const reportType = isReportType(body?.reportType) ? body.reportType : 'general'

    const { data: created, error } = await supabaseAdmin
      .from('player_reports')
      .insert({
        team_id: teamId,
        player_id: playerId,
        coach_id: actor.ownerCoachId,
        author_user_id: actor.userId,
        report_type: reportType,
        status: 'draft',
        report_date: new Date().toISOString().slice(0, 10),
      })
      .select('id, report_type, status, report_date')
      .single()

    if (error) throw error

    // Handed back so the wizard can show the header immediately. Not stored:
    // a draft reads its context live, and only finalization freezes it.
    const context = await buildContext(supabaseAdmin, {
      teamId, playerId, coachId: actor.ownerCoachId,
    })

    return NextResponse.json({ report: created, context, resumed: false })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    console.error('Player report create error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || 'Could not start that report.' },
      { status: 500 }
    )
  }
}
