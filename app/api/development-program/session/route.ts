import { NextRequest, NextResponse } from 'next/server'
import { guard, authorizeTeam, can } from '@/lib/authz'
import { admin, fail, flagOff } from '@/lib/programs/api'
import { challengeValue } from '@/lib/metrics'
import { StoreError } from '@/lib/programs/store'

export const dynamic = 'force-dynamic'

const RATING = new Set(['easy', 'right', 'hard'])
const CHECKPOINT = new Set(['baseline', 'midpoint', 'final', 'session'])
const ymd = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

async function sessionFor(db: any, teamId: string, programId: string, sessionId: string) {
  const { data } = await db.from('program_sessions').select('*').eq('id', sessionId).eq('program_id', programId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new StoreError('Session not found', 'not_found')
  return data as any
}

// POST { teamId, programId, sessionId, action: 'complete' | 'undo' | 'skip', ... }
//
// Recording what happened is a RECORD, so a contributor may do it (a parent
// helper keeping the book). A coach with 'decide' confirms by doing it.
export async function POST(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'record'); if (denied) return denied
  try {
    const b = await request.json()
    const actor = await authorizeTeam(b.teamId, 'record')
    const db = admin()
    const s = await sessionFor(db, b.teamId, b.programId, b.sessionId)

    if (b.action === 'undo') {
      // Un-completing rewrites history, so it needs 'decide'.
      await authorizeTeam(b.teamId, 'decide')
      const { data, error } = await db.rpc('bc_uncomplete_program_session', { p_session: s.id })
      if (error) throw new StoreError(error.message, 'db', error)
      return NextResponse.json({ success: !!(Array.isArray(data) ? data[0] : data)?.ok })
    }
    if (b.action === 'skip') {
      if (s.status !== 'planned') return NextResponse.json({ error: 'Only a planned session can be skipped.' }, { status: 409 })
      const { error } = await db.from('program_sessions').update({ status: 'skipped' }).eq('id', s.id).eq('status', 'planned')
      if (error) throw new StoreError(error.message, 'db', error)
      return NextResponse.json({ success: true })
    }
    if (b.action !== 'complete') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

    const drills = (Array.isArray(b.drills) ? b.drills : []).slice(0, 60).map((d: any) => ({
      position: Number(d.position) || 0, done: !!d.done, rating: RATING.has(d.rating) ? d.rating : null,
    }))
    const ratings: Record<string, string> = {}
    for (const [k, v] of Object.entries(b.ratings || {})) if (RATING.has(v as string) && (s.focus || []).includes(k)) ratings[k] = v as string

    // Measurements: only metric types that exist, values coerced, challenges
    // stored as a percentage with the attempts behind it.
    const rows: any[] = []
    for (const r of (Array.isArray(b.readings) ? b.readings : []).slice(0, 30)) {
      const { data: t } = await db.from('metric_types').select('id, slug, label, unit, shape').eq('slug', String(r.slug)).is('coach_id', null).maybeSingle()
      if (!t) continue
      const checkpoint = CHECKPOINT.has(r.checkpoint) ? r.checkpoint : (s.checkpoint || 'session')
      if ((t as any).shape === 'challenge') {
        const attempts = Math.round(Number(r.attempts)), successes = Math.round(Number(r.successes))
        if (!(attempts > 0) || !(successes >= 0) || successes > attempts) continue
        rows.push({ metric_type_id: (t as any).id, metric: (t as any).label, value: challengeValue(successes, attempts), unit: null, attempts, successes, checkpoint, conditions: String(r.conditions || '').slice(0, 300) || null, note: String(r.note || '').slice(0, 300) || null })
      } else {
        const value = Number(r.value)
        if (!Number.isFinite(value) || value <= 0 || value > 10000) continue
        rows.push({ metric_type_id: (t as any).id, metric: (t as any).label, value, unit: (t as any).unit, checkpoint, conditions: String(r.conditions || '').slice(0, 300) || null, note: String(r.note || '').slice(0, 300) || null })
      }
    }

    const { data, error } = await db.rpc('bc_complete_program_session', {
      p_session: s.id, p_actor: actor.userId, p_confirmed: can(actor.role, 'decide'),
      p_on: ymd(b.on) ?? new Date().toISOString().slice(0, 10),
      p_minutes: Number.isFinite(Number(b.minutes)) ? Math.max(0, Math.min(300, Math.round(Number(b.minutes)))) : null,
      p_drills: drills, p_ratings: ratings, p_pain: !!b.pain,
      p_notes: typeof b.notes === 'string' ? b.notes.slice(0, 2000) : null, p_readings: rows,
    })
    if (error) throw new StoreError(error.message, 'db', error)
    const r = Array.isArray(data) ? data[0] : data
    if (!r?.ok) return NextResponse.json({ error: r?.reason === 'rest_day' ? 'A rest day has nothing to complete.' : 'Could not record that.' }, { status: 409 })
    return NextResponse.json({ success: true, painReported: !!b.pain })
  } catch (e) { return fail(e) }
}

// PATCH { teamId, programId, sessionId, date?, coachNote? } — reschedule a PLANNED session.
// Refuses a date that already has a coached session, and anything on a completed one
// (the database refuses too).
export async function PATCH(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'decide'); if (denied) return denied
  try {
    const b = await request.json()
    const db = admin()
    const s = await sessionFor(db, b.teamId, b.programId, b.sessionId)
    if (s.status !== 'planned') return NextResponse.json({ error: 'Completed or skipped sessions cannot be changed.' }, { status: 409 })
    const patch: Record<string, any> = { origin: 'coach' }
    if (b.date !== undefined) {
      const date = ymd(b.date); if (!date) return NextResponse.json({ error: 'Use a YYYY-MM-DD date.' }, { status: 400 })
      if (s.kind !== 'rest' && s.kind !== 'independent') {
        const { data: clash } = await db.from('program_sessions').select('id').eq('program_id', b.programId).eq('scheduled_date', date)
          .in('kind', ['coached', 'assessment']).neq('id', s.id).limit(1)
        if (clash && clash.length) return NextResponse.json({ error: 'There is already a coached session on that day.' }, { status: 409 })
      }
      patch.scheduled_date = date
    }
    if (typeof b.coachNote === 'string') patch.coach_note = b.coachNote.slice(0, 500)
    const { error } = await db.from('program_sessions').update(patch).eq('id', s.id).eq('status', 'planned')
    if (error) throw new StoreError(error.message, 'db', error)
    return NextResponse.json({ success: true })
  } catch (e) { return fail(e) }
}
