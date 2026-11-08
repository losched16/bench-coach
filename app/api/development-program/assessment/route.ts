import { NextRequest, NextResponse } from 'next/server'
import { guard, authorizeTeam } from '@/lib/authz'
import { admin, fail, flagOff } from '@/lib/programs/api'
import { challengeValue } from '@/lib/metrics'
import { StoreError } from '@/lib/programs/store'

export const dynamic = 'force-dynamic'

// POST { teamId, programId, checkpoint, on, conditions?, readings: [{slug, value | successes+attempts, note?}] }
//
// A measurement taken outside a session (a test day). It goes into
// player_metrics — the one place measurements live — tagged with the program
// and the checkpoint it belongs to.
export async function POST(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'record'); if (denied) return denied
  try {
    const b = await request.json()
    await authorizeTeam(b.teamId, 'record')
    const db = admin()
    const { data: prog } = await db.from('development_programs').select('id, player_id, team_id').eq('id', b.programId).eq('team_id', b.teamId).maybeSingle()
    if (!prog) throw new StoreError('Program not found', 'not_found')
    const { data: team } = await db.from('teams').select('coach_id').eq('id', b.teamId).single()
    const on = /^\d{4}-\d{2}-\d{2}$/.test(b.on) ? b.on : new Date().toISOString().slice(0, 10)
    const checkpoint = ['baseline', 'midpoint', 'final', 'session'].includes(b.checkpoint) ? b.checkpoint : 'session'
    const rows: any[] = []
    for (const r of (Array.isArray(b.readings) ? b.readings : []).slice(0, 30)) {
      const { data: t } = await db.from('metric_types').select('id, label, unit, shape').eq('slug', String(r.slug)).is('coach_id', null).maybeSingle()
      if (!t) continue
      const base = { coach_id: (team as any).coach_id, player_id: (prog as any).player_id, team_id: b.teamId, metric: (t as any).label, measured_on: on,
        source: 'program', metric_type_id: (t as any).id, program_id: b.programId, checkpoint, conditions: String(b.conditions || '').slice(0, 300) || null, note: String(r.note || '').slice(0, 300) || null }
      if ((t as any).shape === 'challenge') {
        const attempts = Math.round(Number(r.attempts)), successes = Math.round(Number(r.successes))
        if (!(attempts > 0) || !(successes >= 0) || successes > attempts) continue
        rows.push({ ...base, value: challengeValue(successes, attempts), unit: null, attempts, successes })
      } else {
        const value = Number(r.value); if (!Number.isFinite(value) || value <= 0 || value > 10000) continue
        rows.push({ ...base, value, unit: (t as any).unit })
      }
    }
    if (!rows.length) return NextResponse.json({ error: 'No valid readings to record.' }, { status: 400 })
    const { error } = await db.from('player_metrics').insert(rows)
    if (error) throw new StoreError(error.message, 'db', error)
    return NextResponse.json({ success: true, recorded: rows.length })
  } catch (e) { return fail(e) }
}
