import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse, Capability } from '@/lib/authz'
import { loadPathway, orderedStages } from '@/lib/developmentPathways'
import { validateMove, MoveKind, PlayerPathwayProgress } from '@/lib/playerPathways'
import { migrationHintFor } from '@/lib/migrationHints'

export const dynamic = 'force-dynamic'

// Everything that happens to a development plan, in one place.
//
// One route rather than six, because the interesting part is the permission
// split and putting it in one table makes it reviewable:
//
//   session   a coach recorded that work happened        'record'  contributor
//   mastery   a coach recorded what they observed        'record'  contributor
//   advance   a coach decided the player is ready        'decide'  admin
//   regress   a coach decided to go back                 'decide'  admin
//   complete  a coach decided the plan is finished       'decide'  admin
//   pause     a coach decided to stop for now            'decide'  admin
//   resume    a coach decided to pick it back up         'decide'  admin
//
// That line is lib/authz.ts's, not a new one: writing down what happened is a
// record, and redirecting a child's development is a decision. It matches
// migration 072's RLS exactly, so the two enforcement points cannot drift.
//
// NOTHING HERE MAY BE CALLED BY AN AI. There is no model in this file and no
// route that advances a player as a side effect of anything. Every write below
// happens because a human pressed a button, which is the brief's third
// governing principle and the reason advancement is a POST from a page rather
// than an inference.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Kind = 'session' | 'mastery' | MoveKind

const NEEDS: Record<Kind, Capability> = {
  session: 'record',
  mastery: 'record',
  advance: 'decide',
  regress: 'decide',
  complete: 'decide',
  pause: 'decide',
  resume: 'decide',
}

const MAX_NOTE = 2000
const clean = (v: unknown, max = MAX_NOTE): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s ? s : null
}

export async function POST(
  request: NextRequest,
  { params }: { params: { progressId: string } }
) {
  let body: any = {}
  try { body = await request.json() } catch { /* handled below */ }

  const kind = String(body?.kind || '') as Kind
  if (!(kind in NEEDS)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  try {
    // The team comes from the ROW, never from the request. A caller passing
    // their own teamId beside someone else's progressId would otherwise be
    // checked against a team they really do administer.
    const { data: row, error: rowErr } = await supabaseAdmin
      .from('player_pathway_progress')
      .select('*, pathway:development_pathways(slug, name)')
      .eq('id', params.progressId)
      .maybeSingle()
    if (rowErr) throw rowErr
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const progress = row as unknown as PlayerPathwayProgress
    const actor = await authorizeTeam((row as any).team_id, NEEDS[kind])

    // ── a record of what happened ────────────────────────────────────────
    if (kind === 'session' || kind === 'mastery') {
      if (progress.status === 'completed') {
        return NextResponse.json(
          { error: 'That plan is complete. Start it again to record new work.' }, { status: 400 })
      }

      const detail: Record<string, any> = {}
      if (kind === 'session') {
        const minutes = Number(body?.minutes)
        // Recorded only when the coach actually gave a number. A default of 30
        // would put a figure in the history that nobody chose.
        if (Number.isFinite(minutes) && minutes > 0 && minutes <= 480) {
          detail.minutes = Math.round(minutes)
        }
        const ids = Array.isArray(body?.drillIds) ? body.drillIds : []
        detail.drill_ids = ids.filter((d: any) => typeof d === 'string').slice(0, 40)
      } else {
        // The signal TEXT, checked against the stage's canonical list. Anything
        // that is not currently one of that stage's signals is dropped rather
        // than stored, so the history cannot fill up with strings the pathway
        // never offered.
        const slug = (row as any).pathway?.slug
        const pathway = slug ? await loadPathway(supabaseAdmin, slug) : null
        const stage = pathway
          ? orderedStages(pathway).find(s => s.stage_key === progress.current_stage_key)
          : null
        const canonical = new Set(stage?.mastery_signals || [])
        const sent = Array.isArray(body?.signals) ? body.signals : []
        detail.signals = sent.filter((s: any) => typeof s === 'string' && canonical.has(s))
      }

      const { error } = await supabaseAdmin.from('player_pathway_events').insert({
        progress_id: params.progressId,
        team_id: progress.team_id,       // replaced by the trigger regardless
        event_type: kind === 'session' ? 'session_logged' : 'mastery_recorded',
        stage_key: progress.current_stage_key,
        stage_number: progress.current_stage_number,
        detail,
        note: clean(body?.note),
        actor_user_id: actor.userId,
        ...(clean(body?.occurredOn, 10) ? { occurred_on: clean(body?.occurredOn, 10) } : {}),
      })
      if (error) throw error

      return NextResponse.json({ recorded: true })
    }

    // ── a decision about what happens next ───────────────────────────────
    const slug = (row as any).pathway?.slug
    const pathway = slug ? await loadPathway(supabaseAdmin, slug) : null

    // The same guard the page renders its buttons from. Run again here because
    // a hidden button is not a rule — a stale tab or a replayed request is
    // enough to get past one.
    const verdict = validateMove(pathway, progress, kind, clean(body?.toStageKey, 200))
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 409 })

    const now = new Date().toISOString()
    let update: Record<string, any> = {}
    let event: Record<string, any> = {
      progress_id: params.progressId,
      team_id: progress.team_id,
      stage_key: progress.current_stage_key,
      stage_number: progress.current_stage_number,
      note: clean(body?.note),
      actor_user_id: actor.userId,
    }

    if (kind === 'advance' || kind === 'regress') {
      const to = verdict.stage!
      update = {
        current_stage_key: to.stage_key,
        current_stage_number: to.stage_number,
        // Reset on both directions: "how long on this stage" is about the
        // stage they are on now, and a regression starts that clock again.
        stage_started_at: now,
      }
      event = {
        ...event,
        event_type: kind === 'advance' ? 'advanced' : 'regressed',
        from_stage_key: progress.current_stage_key,
        to_stage_key: to.stage_key,
        // The stage they LANDED on, so the timeline and the session counts
        // agree about where work done after this point belongs.
        stage_key: to.stage_key,
        stage_number: to.stage_number,
      }
    } else if (kind === 'complete') {
      update = { status: 'completed', completed_at: now }
      event = { ...event, event_type: 'completed' }
    } else if (kind === 'pause') {
      update = { status: 'paused' }
      event = { ...event, event_type: 'paused' }
    } else {
      update = { status: 'active' }
      event = { ...event, event_type: 'resumed' }
    }

    // Conditional on the stage we validated against. Two coaches advancing the
    // same player at the same moment would otherwise both succeed and the
    // player would skip a stage with two events claiming they did not.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('player_pathway_progress')
      .update(update)
      .eq('id', params.progressId)
      .eq('current_stage_key', progress.current_stage_key)
      .eq('status', progress.status)
      .select('id, current_stage_key, current_stage_number, status')
    if (updErr) throw updErr
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'This plan changed while you were looking at it. Reload and try again.' },
        { status: 409 })
    }

    const { error: evErr } = await supabaseAdmin.from('player_pathway_events').insert(event)
    if (evErr) throw evErr

    return NextResponse.json({ progress: updated[0] })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    const hint = migrationHintFor(error)
    if (hint) return NextResponse.json({ error: hint.message }, { status: 503 })

    console.error('Player pathway event error:', error)
    return NextResponse.json({ error: 'Could not record that' }, { status: 500 })
  }
}
