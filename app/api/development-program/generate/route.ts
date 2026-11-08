import { NextRequest, NextResponse } from 'next/server'
import { guard, authorizePlayer } from '@/lib/authz'
import { admin, fail, flagOff } from '@/lib/programs/api'
import { createProgramDraft } from '@/lib/programs/service'
import { BriefSchema } from '@/lib/programs/types'

export const dynamic = 'force-dynamic'
// Context + drill pool + up to a handful of parallel model calls.
export const maxDuration = 120

// POST { teamId, playerId, message?, overrides? } → { draftId } | { questions }
//
// The structured entry point ("Create Development Program"). The chat uses the
// same createProgramDraft. Generating a draft writes NOTHING a coach has not
// approved — it is a private draft until /draft/save.
export async function POST(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'ask')
  if (denied) return denied
  try {
    const body = await request.json()
    const { teamId, playerId } = body
    if (typeof body.message !== 'string' && !body.overrides) {
      return NextResponse.json({ error: 'Describe the program or fill in the form.' }, { status: 400 })
    }
    // Overrides are validated field by field; unknown keys are dropped.
    const ov = BriefSchema.partial().omit({ playerId: true, playerName: true, age: true }).safeParse(body.overrides || {})
    if (!ov.success) return NextResponse.json({ error: 'Some form values were not valid.' }, { status: 400 })

    const actor = await authorizePlayer(playerId, { teamId, capability: 'ask' })
    const db = admin()
    const { data: team } = await db.from('teams').select('coach_id').eq('id', teamId).single()
    const result = await createProgramDraft({
      db, teamId, coachId: (team as any).coach_id, userId: actor.userId, playerId,
      message: String(body.message || '').slice(0, 4000), overrides: ov.data as any,
    })
    return NextResponse.json(result)
  } catch (e) { return fail(e) }
}
