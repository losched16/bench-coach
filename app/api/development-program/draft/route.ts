import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/authz'
import { admin, fail, flagOff } from '@/lib/programs/api'
import { discardDraft, getDraft, updateDraft } from '@/lib/programs/store'
import { refreshDerived } from '@/lib/programs/edits'
import { repairDraft, validateDraft } from '@/lib/programs/validate'
import { loadPool } from '@/lib/programs/service'
import { DraftSchema } from '@/lib/programs/types'
import { drillRows, resolveMedia } from '@/lib/programs/media'

export const dynamic = 'force-dynamic'

// GET ?teamId=&draftId=   — the draft, with fresh quality checks
export async function GET(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'read'); if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const db = admin()
    const row = await getDraft(db, String(sp.get('draftId')), String(sp.get('teamId')))
    const { data: owner } = await db.from('teams').select('coach_id').eq('id', String(sp.get('teamId'))).single()
    const media = await resolveMedia(db, (owner as any)?.coach_id, drillRows(row.payload))
    return NextResponse.json({ drillMedia: media.drillMedia, related: media.related, draft: row.payload, version: row.version, status: row.status, playerId: row.player_id, savedProgramId: row.saved_program_id })
  } catch (e) { return fail(e) }
}

// PATCH { teamId, draftId, version, draft } — edits to a DRAFT (scratch, not a record), so 'record'. Saving needs 'decide'. Editing is a
// decision about a child's training, so it needs 'decide'. Server re-derives
// minutes, supervision and the quality checks; the client's say-so is not trusted.
export async function PATCH(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'record'); if (denied) return denied
  try {
    const { teamId, draftId, version, draft } = await request.json()
    const parsed = DraftSchema.safeParse(draft)
    if (!parsed.success) return NextResponse.json({ error: 'That edit is not a valid program.' }, { status: 422 })
    const d = parsed.data
    refreshDerived(d)
    d.qualityReport = { checks: [], repairs: repairDraft(d), warnings: d.qualityReport?.warnings ?? [] }
    const db = admin()
    const { data: team } = await db.from('teams').select('coach_id').eq('id', teamId).single()
    const pool = await loadPool(db, (team as any).coach_id)
    d.qualityReport.checks = validateDraft(d, { drillIds: new Set(pool.map(p => p.id)) })
    const saved = await updateDraft(db, String(draftId), String(teamId), Number(version), d)
    return NextResponse.json({ version: saved.version, qualityReport: d.qualityReport, draft: d })
  } catch (e) { return fail(e) }
}

// DELETE ?teamId=&draftId= — discard. Nothing else is touched.
export async function DELETE(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'record'); if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    await discardDraft(admin(), String(sp.get('draftId')), String(sp.get('teamId')))
    return NextResponse.json({ success: true })
  } catch (e) { return fail(e) }
}
