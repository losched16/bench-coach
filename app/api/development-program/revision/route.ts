import { NextRequest, NextResponse } from 'next/server'
import { guard, authorizeTeam } from '@/lib/authz'
import { admin, fail, flagOff } from '@/lib/programs/api'
import { applyChanges, proposeAdjustments, summariseAssessment, type CompletionIn, type MetricDef, type ProgramReading } from '@/lib/programs/progress'
import { SKILLS } from '@/lib/programs/skills'
import { patchFromSessions, loadProgram, sessionsFromRows, StoreError } from '@/lib/programs/store'
import type { SkillKey } from '@/lib/programs/types'

export const dynamic = 'force-dynamic'

// POST { teamId, programId, action: 'propose' }                 → recompute proposals from what was recorded
// POST { teamId, programId, action: 'apply' | 'reject', revisionId }
//
// Proposals are computed on the server from recorded completions and
// measurements — never taken from the client — and they only ever change
// FUTURE planned sessions, and only after a head coach ('decide') approves.
export async function POST(request: NextRequest) {
  const off = flagOff(); if (off) return off
  const denied = await guard(request, 'ask'); if (denied) return denied
  try {
    const b = await request.json()
    const db = admin()
    const view = await loadProgram(db, b.programId, b.teamId)
    const today = new Date().toISOString().slice(0, 10)

    if (b.action === 'propose') {
      await authorizeTeam(b.teamId, 'ask')
      const { data: types } = await db.from('metric_types').select('id, slug, label, unit, shape, direction').is('coach_id', null)
      const byId = new Map<string, any>((types || []).map((t: any) => [t.id, t]))
      const bySlug = new Map<string, any>((types || []).map((t: any) => [t.slug, t]))
      const readings: ProgramReading[] = view.readings.map((r: any) => ({ ...r, slug: byId.get(r.metric_type_id)?.slug ?? r.metric }))
      const skills = view.skills.map((s: any) => s.skill as SkillKey)
      const defs = new Map<string, MetricDef>()
      for (const sk of skills) for (const m of SKILLS[sk]?.metrics || []) {
        const t = bySlug.get(m.metricSlug)
        defs.set(m.metricSlug, { slug: m.metricSlug, label: t?.label ?? m.label, unit: t?.unit ?? m.unit, direction: t?.direction ?? m.direction, shape: t?.shape ?? m.shape })
      }
      const lines = Array.from(defs.values()).map(d => summariseAssessment(d, readings))
      const completions: CompletionIn[] = view.sessions.filter((s: any) => s.completion).map((s: any) => ({
        sessionKey: s.session_key, date: s.completion.completed_on, skills: s.focus, ratings: s.completion.ratings || {}, painReported: !!s.completion.pain_reported,
      }))
      const proposals = proposeAdjustments({ completions, lines, skills })
      const open = new Set(view.revisions.filter((r: any) => r.status === 'proposed').map((r: any) => r.summary))
      const fresh = proposals.filter(p => p.changes.length > 0 && !open.has(p.summary))
      if (fresh.length) {
        const { error } = await db.from('program_revisions').insert(fresh.map(p => ({
          program_id: view.program.id, team_id: b.teamId, from_version: view.program.version, summary: p.summary,
          proposed_changes: p.changes, evidence: p.evidence, proposed_by: 'ai',
        })))
        if (error) throw new StoreError(error.message, 'db', error)
      }
      // 'maintain' / 'reassess' proposals carry no change; they are advice shown, not records.
      return NextResponse.json({ created: fresh.length, advice: proposals.filter(p => p.changes.length === 0) })
    }

    // Deciding is a decision.
    const actor = await authorizeTeam(b.teamId, 'decide')
    const rev = view.revisions.find((r: any) => r.id === b.revisionId)
    if (!rev) throw new StoreError('Revision not found', 'not_found')
    if (rev.status !== 'proposed') return NextResponse.json({ error: 'That change was already decided.' }, { status: 409 })

    if (b.action === 'reject') {
      const { error } = await db.from('program_revisions').update({ status: 'rejected', decided_by: actor.userId, decided_at: new Date().toISOString() }).eq('id', rev.id).eq('status', 'proposed')
      if (error) throw new StoreError(error.message, 'db', error)
      return NextResponse.json({ success: true })
    }
    if (b.action !== 'apply') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

    const rows = sessionsFromRows(view.sessions)
    const { sessions: next, touched } = applyChanges(rows, rev.proposed_changes, today)
    const { data, error } = await db.rpc('bc_apply_program_revision', {
      p_revision: rev.id, p_actor: actor.userId, p_patch: patchFromSessions(next, touched),
    })
    if (error) throw new StoreError(error.message, 'db', error)
    const r = Array.isArray(data) ? data[0] : data
    if (!r?.ok) return NextResponse.json({ error: r?.reason === 'program_changed_since_proposal' ? 'The program changed since this was proposed. Refresh to see new suggestions.' : 'Could not apply that.' }, { status: 409 })
    return NextResponse.json({ success: true, version: r.new_version, sessionsChanged: touched.length })
  } catch (e) { return fail(e) }
}
