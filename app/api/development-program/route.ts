import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/authz'
import { admin, fail, flagOff } from '@/lib/programs/api'
import { visibleDrills } from '@/lib/drills'
import { listOpenDrafts, listPrograms, loadProgram } from '@/lib/programs/store'
import { SKILLS } from '@/lib/programs/skills'
import { summariseAssessment, type MetricDef, type ProgramReading } from '@/lib/programs/progress'

export const dynamic = 'force-dynamic'

// GET ?teamId=&playerId=      — programs and open drafts for a team (or one player)
// GET ?teamId=&programId=     — one program with sessions, drills, completions,
//                               revisions and assessment comparisons
export async function GET(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'read'); if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const teamId = String(sp.get('teamId')), programId = sp.get('programId')
    const db = admin()
    if (!programId) {
      const [programs, drafts] = await Promise.all([listPrograms(db, teamId, sp.get('playerId')), listOpenDrafts(db, teamId, sp.get('playerId'))])
      return NextResponse.json({ programs, drafts })
    }
    const view = await loadProgram(db, programId, teamId)

    // Library videos come from the library, by id — never stored on the program.
    const ids = Array.from(new Set(view.sessions.flatMap(s => s.drills.map((d: any) => d.drill_id).filter(Boolean))))
    let drillMedia: Record<string, any> = {}
    if (ids.length) {
      // visibleDrills, not a bare read: a drill a coach wrote privately is
      // resolvable by id only for that coach's own team.
      const { data: team } = await db.from('teams').select('coach_id').eq('id', teamId).single()
      const { data } = await visibleDrills(db, (team as any)?.coach_id, 'id, youtube_video_id, youtube_url, youtube_start_seconds, channel').in('id', ids)
      drillMedia = Object.fromEntries((data || []).map((d: any) => [d.id, d]))
    }

    // Assessment comparison per metric: baseline vs latest under the recorded conditions.
    const { data: types } = await db.from('metric_types').select('id, slug, label, unit, shape, direction').is('coach_id', null)
    const bySlug = new Map<string, any>((types || []).map((t: any) => [t.slug, t]))
    const byId = new Map<string, any>((types || []).map((t: any) => [t.id, t]))
    const readings: ProgramReading[] = view.readings.map((r: any) => ({ ...r, slug: byId.get(r.metric_type_id)?.slug ?? r.metric, checkpoint: r.checkpoint, conditions: r.conditions }))
    const wanted = new Map<string, MetricDef>()
    for (const sk of view.skills) for (const m of SKILLS[sk.skill as keyof typeof SKILLS]?.metrics || []) {
      const t = bySlug.get(m.metricSlug)
      wanted.set(m.metricSlug, { slug: m.metricSlug, label: t?.label ?? m.label, unit: t?.unit ?? m.unit, direction: t?.direction ?? m.direction, shape: t?.shape ?? m.shape })
    }
    const assessments = Array.from(wanted.values()).map(def => summariseAssessment(def, readings))
    return NextResponse.json({ ...view, drillMedia, assessments, metricTypes: Object.fromEntries(Array.from(bySlug.entries()).map(([k, v]) => [k, { id: v.id, shape: v.shape, unit: v.unit, label: v.label }])) })
  } catch (e) { return fail(e) }
}
