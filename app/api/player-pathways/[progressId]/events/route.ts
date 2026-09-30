import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeProgress, authzResponse, Capability } from '@/lib/authz'
import { loadPathway, orderedStages } from '@/lib/developmentPathways'
import { validateMove, MoveKind, PlayerPathwayProgress } from '@/lib/playerPathways'
import { migrationHintFor } from '@/lib/migrationHints'
import { practiceLink, practiceDrillIds, practiceMinutes, practiceSessionDate, recordedFor } from '@/lib/practicePlanLink'

export const dynamic = 'force-dynamic'

// Everything that happens to a development plan, in one place.
//
// One route rather than six, because the interesting part is the permission
// split and putting it in one table makes it reviewable:
//
//   session   a coach recorded that work happened        'record'  contributor
//             (with practicePlanId: a saved practice built for this plan's
//             pathway, recorded once — see lib/practicePlanLink.ts)
//   mastery   a coach recorded what they observed        'record'  contributor
//   note      a coach wrote something down               'record'  contributor
//   advance   a coach decided the player is ready        'decide'  admin
//   regress   a coach decided to go back                 'decide'  admin
//   jump      a coach put them on a specific stage       'decide'  admin
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

type Kind = 'session' | 'mastery' | 'note' | MoveKind

const NEEDS: Record<Kind, Capability> = {
  session: 'record',
  mastery: 'record',
  // A note is an observation written down, which is the definition of
  // 'record'. A parent helper keeping the book may write "the pogo rhythm fell
  // apart today"; they still may not decide the kid moves to stage 5.
  note: 'record',
  advance: 'decide',
  regress: 'decide',
  // Putting a player on an arbitrary stage is the same kind of act as
  // advancing them one — it changes what the team works on with that child.
  jump: 'decide',
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

// The capability is chosen by the ACTION — see NEEDS above — and the team comes
// from the enrollment ROW rather than from the request, because a caller passing
// their own teamId beside someone else's progressId would otherwise be checked
// against a team they really do administer. authorizeProgress does both, and is
// the first thing this handler does.
export async function POST(
  request: NextRequest,
  { params }: { params: { progressId: string } }
) {
  let body: any = {}
  try { body = await request.json() } catch { /* handled below */ }
  const kind = String(body?.kind || '') as Kind
  if (!(kind in NEEDS)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  try {
    const actor = await authorizeProgress(params.progressId, NEEDS[kind])

    const { data: row, error: rowErr } = await supabaseAdmin
      .from('player_pathway_progress')
      .select('*, pathway:development_pathways(slug, name)')
      .eq('id', params.progressId)
      .maybeSingle()
    if (rowErr) throw rowErr
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const progress = row as unknown as PlayerPathwayProgress

    // ── a record of what happened ────────────────────────────────────────
    if (kind === 'session' || kind === 'mastery' || kind === 'note') {
      if (progress.status === 'completed') {
        return NextResponse.json(
          { error: 'That plan is complete. Start it again to record new work.' }, { status: 400 })
      }

      // WHICH STAGE THIS IS ABOUT.
      //
      // Not necessarily the one the player is on. The plan is browsable, so a
      // coach reading ahead to stage 6 may well want to note "he can already
      // do this" against stage 6 — and filing that on stage 3 because that is
      // where he officially stands would put the observation where nobody will
      // look for it. Validated against the pathway so it cannot be arbitrary.
      const askedStage = clean(body?.stageKey, 200)
      const slug = (row as any).pathway?.slug
      const pathway = slug ? await loadPathway(supabaseAdmin, slug) : null
      const stages = pathway ? orderedStages(pathway) : []

      if (askedStage && !stages.some(s => s.stage_key === askedStage)) {
        return NextResponse.json({ error: 'That stage is not part of this plan' }, { status: 400 })
      }
      const stageKey = askedStage || progress.current_stage_key
      const target = stages.find(s => s.stage_key === stageKey) || null
      const stageNumber = target?.stage_number ?? progress.current_stage_number

      if (kind === 'note') {
        const text = clean(body?.note)
        if (!text) return NextResponse.json({ error: 'A note needs some text' }, { status: 400 })

        const { error } = await supabaseAdmin.from('player_pathway_events').insert({
          progress_id: params.progressId,
          team_id: progress.team_id,
          event_type: 'note',
          stage_key: stageKey,
          stage_number: stageNumber,
          note: text,
          actor_user_id: actor.userId,
          ...(clean(body?.occurredOn, 10) ? { occurred_on: clean(body?.occurredOn, 10) } : {}),
        })
        if (error) throw error
        return NextResponse.json({ recorded: true })
      }

      const detail: Record<string, any> = {}
      let occurredOn = clean(body?.occurredOn, 10)

      // ── a saved practice, recorded on this plan (migration 077) ─────────
      //
      // The practice page sends only the practice id. What happened is read
      // from the practice itself — its length, its drills, its date — rather
      // than trusted from the request, and the practice must belong to this
      // plan's team and have been built for this plan's pathway. Once per
      // practice per plan: checked here so the coach is told, and enforced by
      // the unique index in 077 so two tabs cannot get past it.
      const practicePlanId = kind === 'session' ? clean(body?.practicePlanId, 64) : null
      if (practicePlanId) {
        const { data: plan } = await supabaseAdmin
          .from('practice_plans').select('*').eq('id', practicePlanId).maybeSingle()
        const link = practiceLink(plan as any)
        if (!plan || (plan as any).team_id !== progress.team_id) {
          return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
        }
        if (!link || link.slug !== slug) {
          return NextResponse.json({ error: 'That practice was not built from this plan' }, { status: 400 })
        }
        const { data: prior } = await supabaseAdmin
          .from('player_pathway_events').select('event_type, detail')
          .eq('progress_id', params.progressId).eq('event_type', 'session_logged')
        if (recordedFor((prior || []) as any[], practicePlanId)) {
          return NextResponse.json({ error: 'Already recorded', alreadyRecorded: true }, { status: 409 })
        }
        detail.practice_plan_id = practicePlanId
        const mins = practiceMinutes((plan as any).duration_minutes)
        if (mins) detail.minutes = mins
        detail.drill_ids = practiceDrillIds((plan as any).content)
        occurredOn = practiceSessionDate((plan as any).scheduled_for, new Date().toISOString().slice(0, 10))
      } else if (kind === 'session') {
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
        const canonical = new Set(target?.mastery_signals || [])
        const sent = Array.isArray(body?.signals) ? body.signals : []
        detail.signals = sent.filter((s: any) => typeof s === 'string' && canonical.has(s))
      }

      const { error } = await supabaseAdmin.from('player_pathway_events').insert({
        progress_id: params.progressId,
        team_id: progress.team_id,       // replaced by the trigger regardless
        event_type: kind === 'session' ? 'session_logged' : 'mastery_recorded',
        stage_key: stageKey,
        stage_number: stageNumber,
        detail,
        note: clean(body?.note),
        actor_user_id: actor.userId,
        ...(occurredOn ? { occurred_on: occurredOn } : {}),
      })
      // 23505: the 077 index caught a repeat the check above raced with.
      if (error && (error as any).code === '23505' && practicePlanId) {
        return NextResponse.json({ error: 'Already recorded', alreadyRecorded: true }, { status: 409 })
      }
      if (error) throw error

      return NextResponse.json({ recorded: true })
    }

    // ── a decision about what happens next ───────────────────────────────
    const moveSlug = (row as any).pathway?.slug
    const movePathway = moveSlug ? await loadPathway(supabaseAdmin, moveSlug) : null

    // The same guard the page renders its buttons from. Run again here because
    // a hidden button is not a rule — a stale tab or a replayed request is
    // enough to get past one.
    const verdict = validateMove(movePathway, progress, kind, clean(body?.toStageKey, 200))
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

    if (kind === 'advance' || kind === 'regress' || kind === 'jump') {
      const to = verdict.stage!

      // A JUMP IS STILL A MOVE, AND THE HISTORY SAYS WHICH WAY IT WENT.
      //
      // There is no 'jumped' event type and there should not be: the question
      // the timeline answers is "did this child go forward or back", and that
      // is the same question whether they moved one stage or four. So the
      // direction is worked out from the stage numbers and recorded as an
      // ordinary advance or regression, with from/to naming both ends. That
      // also means planOutline and every existing reader understand it without
      // knowing this feature exists.
      const from = progress.current_stage_number ?? 0
      const forward = (to.stage_number ?? 0) >= from

      update = {
        current_stage_key: to.stage_key,
        current_stage_number: to.stage_number,
        // Reset in every direction: "how long on this stage" is about the
        // stage they are on now, and going back starts that clock again.
        stage_started_at: now,
      }
      event = {
        ...event,
        event_type: kind === 'jump'
          ? (forward ? 'advanced' : 'regressed')
          : kind === 'advance' ? 'advanced' : 'regressed',
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
