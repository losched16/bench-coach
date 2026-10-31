import { NextRequest, NextResponse } from 'next/server'
import { requireSession, authorizeTeam, authorizePlayer } from '@/lib/authz'
import { notEnabled, db, fail, isUuid } from '@/lib/speedProgram/server'
import { validateAssignmentInput, buildPlan, recommendedDays } from '@/lib/speedProgram/rules'
import { TEMPLATE_KEY, TEMPLATE_VERSION } from '@/lib/speedProgram/template'

export const dynamic = 'force-dynamic'

// GET ?teamId=&playerId=  programs for a player (read: any team member)
export async function GET(request: NextRequest) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const teamId = sp.get('teamId'), playerId = sp.get('playerId')
    await authorizeTeam(teamId, 'read')
    if (playerId && !isUuid(playerId)) return NextResponse.json({ programs: [] })
    let q = db.from('speed_program_assignments').select('id, player_id, level, status, current_week, space, days_per_week, started_at, completed_at').eq('team_id', teamId as string)
    if (playerId) q = q.eq('player_id', playerId)
    const { data, error } = await q.order('started_at', { ascending: false }).limit(100)
    if (error) throw error
    return NextResponse.json({ programs: data || [] })
  } catch (e) { return fail(e) }
}

// POST { teamId, playerId, level, daysPerWeek?, intake }  assign (decide: admin and above)
export async function POST(request: NextRequest) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    let body: any = null
    try { body = await request.json() } catch { /* below */ }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
    // Scope is resolved from the team and checked against the player: a player
    // id on its own is not a permission.
    const who = await authorizePlayer(body.playerId, { teamId: body.teamId, capability: 'decide' })
    const input = validateAssignmentInput(body)
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })
    const { level, daysPerWeek, intake } = input.value

    const live = await db.from('speed_program_assignments').select('id').eq('player_id', body.playerId).eq('team_id', body.teamId).eq('template_key', TEMPLATE_KEY).neq('status', 'completed').limit(1)
    if (live.error) throw live.error
    if ((live.data || []).length) return NextResponse.json({ error: 'This player already has a speed program running. Finish or pause it first.', existingId: (live.data as any)[0].id }, { status: 409 })

    const { data, error } = await db.from('speed_program_assignments').insert({
      player_id: body.playerId, team_id: body.teamId, template_key: TEMPLATE_KEY, template_version: TEMPLATE_VERSION,
      level, space: intake.space, days_per_week: daysPerWeek, intake, plan: buildPlan(), created_by: who.userId,
      // Explicit, so a program never depends on column defaults to start at the beginning.
      current_week: 1, status: 'active', unlocks: [],
    }).select('id').single()
    if (error) {
      if ((error as any).code === '23505') return NextResponse.json({ error: 'This player already has a speed program running.' }, { status: 409 })
      throw error
    }
    const id = (data as any).id as string
    const rec = recommendedDays(level, intake.weekly_games, intake.weekly_hard_practices)
    const ev = await db.from('speed_program_events').insert({ assignment_id: id, event_type: 'enrolled', actor_user_id: who.userId, detail: { level, daysPerWeek, space: intake.space, suggestedDays: rec.days, templateVersion: TEMPLATE_VERSION } })
    if (ev.error) throw ev.error
    return NextResponse.json({ id }, { status: 201 })
  } catch (e) { return fail(e) }
}
