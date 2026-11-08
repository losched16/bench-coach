import { NextRequest, NextResponse } from 'next/server'
import { guard, authorizeTeam } from '@/lib/authz'
import { admin, BLOCKING_CHECKS, fail, flagOff } from '@/lib/programs/api'
import { getDraft, saveDraft } from '@/lib/programs/store'
import { loadPool } from '@/lib/programs/service'
import { validateDraft } from '@/lib/programs/validate'

export const dynamic = 'force-dynamic'

// POST { teamId, draftId } — THE approval. The only way a program exists.
//
// Needs 'decide' (head coach). Re-validates server-side, refuses on a blocking
// failure, then saves in one transaction. Calling it twice is safe: the second
// call returns the program the first one made.
export async function POST(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'decide'); if (denied) return denied
  try {
    const { teamId, draftId } = await request.json()
    const actor = await authorizeTeam(teamId, 'decide')
    const db = admin()
    const row = await getDraft(db, String(draftId), String(teamId))
    if (row.status === 'saved' && row.saved_program_id) return NextResponse.json({ programId: row.saved_program_id, alreadySaved: true })
    if (row.status !== 'draft') return NextResponse.json({ error: 'This draft was discarded.' }, { status: 409 })

    const { data: team } = await db.from('teams').select('coach_id').eq('id', teamId).single()
    const pool = await loadPool(db, (team as any).coach_id)
    const blockers = validateDraft(row.payload, { drillIds: new Set(pool.map(p => p.id)) }).filter(c => !c.ok && BLOCKING_CHECKS.has(c.id))
    if (blockers.length) {
      return NextResponse.json({ error: 'This program cannot be saved yet.', problems: blockers.map(b => b.detail) }, { status: 422 })
    }
    const saved = await saveDraft(db, row, actor.userId)
    return NextResponse.json(saved)
  } catch (e) { return fail(e) }
}
