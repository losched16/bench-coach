import { NextRequest, NextResponse } from 'next/server'
import { migrationHintFor } from '@/lib/migrationHints'
import { createClient } from '@supabase/supabase-js'
import { guard } from '@/lib/authz'
import { resolveSteps, clampStep, PlanStep } from '@/lib/progression'
import { gatherCandidates, rankByFit } from '@/lib/drillRetrieval'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Different drills for a priority that is already running.
//
// The important thing this route does is NOT hand out more drills. It records
// that the coach asked. Once is "that drill needed a net we don't own". Twice,
// with sessions being logged and nothing moving, almost always means the cause
// we named was wrong — and the check-in reads this counter and is told to say
// so rather than prescribing a third set of drills for a problem that isn't
// there. Swapping drills forever is how a plan fails quietly.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

const DRILL_FIELDS =
  'id, drill_name, description, youtube_video_id, youtube_url, thumbnail_url, channel, ' +
  'skill_category, difficulty_level, equipment_needed, ai_coaching_notes, min_age, max_age, ' +
  'competition_level, progression_level, status, reps_guidance, frequency_guidance, success_markers'

// ---------------------------------------------------------------------------
// GET ?prescriptionId=&coachId=  — the drills currently prescribed
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const prescriptionId = searchParams.get('prescriptionId')
  const coachId = searchParams.get('coachId')

  if (!prescriptionId || !coachId) {
    return NextResponse.json({ error: 'prescriptionId and coachId required' }, { status: 400 })
  }

  try {
    // Migration 036 may not have been applied yet, and a plan screen that
    // 500s because the progression columns are missing is worse than one
    // that shows a single step.
    let p: any = null
    const withSteps = await supabaseAdmin
      .from('prescriptions')
      .select('id, drill_ids, drill_swaps, plan_steps, current_step')
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (withSteps.error) {
      const legacy = await supabaseAdmin
        .from('prescriptions')
        .select('id, drill_ids, drill_swaps')
        .eq('id', prescriptionId)
        .eq('coach_id', coachId)
        .maybeSingle()
      p = legacy.data
    } else {
      p = withSteps.data
    }

    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const ids = (p.drill_ids || []) as string[]
    if (ids.length === 0) {
      return NextResponse.json({ drills: [], swaps: p.drill_swaps || 0, steps: [], currentStep: 1 })
    }

    const { data: drills } = await supabaseAdmin
      .from('drill_resources').select(DRILL_FIELDS).in('id', ids)

    // Preserve prescribed order — it is a progression, not a set.
    const byId = new Map((drills || []).map((d: any) => [d.id, d]))
    const ordered = ids.map(id => byId.get(id)).filter(Boolean)

    // Derived here rather than stored-only, so every plan ever issued stages
    // correctly without a backfill.
    const steps = resolveSteps((p.plan_steps || null) as PlanStep[] | null, ordered as any[])

    return NextResponse.json({
      drills: ordered,
      swaps: p.drill_swaps || 0,
      steps,
      currentStep: clampStep(p.current_step, steps),
    })
  } catch (error: any) {
    console.error('Priority drills GET error:', error)
    // The columns from migration 022 may not exist yet — the page must render.
    return NextResponse.json({ drills: [], swaps: 0, steps: [], currentStep: 1, needsMigration: true, migrationMessage: migrationHintFor(error)?.message || null })
  }
}

// ---------------------------------------------------------------------------
// POST { prescriptionId, coachId, reason? } — swap in different drills
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const body = await request.json()
    const { prescriptionId, coachId, reason } = body
    if (!coachId) {
      return NextResponse.json({ error: 'coachId required' }, { status: 400 })
    }

    // Draft mode: the analysis has been read but not committed yet, so there is
    // no prescriptions row holding the exclusion list. The caller supplies what
    // to avoid and what the priority is about, and nothing is written — the
    // whole point of the review step is that nothing is committed until the
    // coach says so.
    if (!prescriptionId) {
      const { searchText, excludeIds, playerAge: draftAge, problemSlug, count } = body
      if (!searchText) {
        return NextResponse.json({ error: 'searchText required in draft mode' }, { status: 400 })
      }
      const pool = await gatherCandidates(supabaseAdmin, {
        problemSlug: problemSlug || null,
        exclude: new Set<string>(excludeIds || []),
        playerAge: draftAge,
        searchText,
        coachId,
      })
      if (pool.length === 0) {
        return NextResponse.json({
          drills: [],
          exhausted: true,
          message:
            'The library is out of drills for this one that you haven’t already turned down. ' +
            'Make it the priority as it stands and attack it your own way, or reword what you asked about.',
        })
      }
      // `count` is how many CHOICES to offer for one slot. Without it this is
      // the old behaviour: a fresh set to replace the whole list.
      const want = Number(count) > 0 ? Math.min(Number(count), 5) : 3
      const picked = await rankByFit(searchText, reason, pool, want)
      return NextResponse.json({ drills: (picked.length ? picked : pool.slice(0, want)).slice(0, want) })
    }

    const replaceDrillId: string | null = body.replaceDrillId || null
    const wantCount: number = Number(body.count) > 0 ? Math.min(Number(body.count), 5) : 0

    const { data: p } = await supabaseAdmin
      .from('prescriptions')
      .select('id, priority, summary, problem_id, focus_area, drill_ids, retired_drill_ids, drill_swaps, player_id, team_id, scope')
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const pres = p as any

    const current: string[] = pres.drill_ids || []
    const retired: string[] = pres.retired_drill_ids || []
    // Never hand back something already set aside — that is the whole point.
    const exclude = new Set([...current, ...retired])

    // Age and level, so the replacements are as well-filtered as the originals.
    let playerAge: number | undefined
    if (pres.player_id) {
      const { data: player } = await supabaseAdmin
        .from('players').select('birth_year').eq('id', pres.player_id).maybeSingle()
      if ((player as any)?.birth_year) {
        playerAge = new Date().getFullYear() - (player as any).birth_year
      }
    }

    const searchText = [pres.priority, pres.summary, pres.focus_area].filter(Boolean).join(' ')

    const eligible = await gatherCandidates(supabaseAdmin, {
      problemSlug: pres.problem_id || null,
      exclude,
      playerAge,
      searchText,
      coachId,
    })

    if (eligible.length === 0) {
      return NextResponse.json({
        drills: [],
        exhausted: true,
        message:
          'The library is out of drills for this one that you haven’t already tried. ' +
          'That is usually a sign the priority needs rethinking rather than more drills — give an update and let it re-read.',
      })
    }

    // Offering choices for one slot writes nothing — the coach hasn't picked
    // yet, and a swap counter that ticks on "let me look" would poison the
    // signal the check-in reads.
    if (wantCount > 0) {
      const options = await rankByFit(searchText, reason, eligible, wantCount)
      return NextResponse.json({
        options: (options.length ? options : eligible.slice(0, wantCount)).slice(0, wantCount),
        forDrillId: replaceDrillId,
      })
    }

    const picked = await rankByFit(searchText, reason, eligible)
    const finalDrills = (picked.length ? picked : eligible.slice(0, 3)).slice(0, 4)

    const { error: upErr } = await supabaseAdmin
      .from('prescriptions')
      .update({
        drill_ids: finalDrills.map(d => d.id),
        retired_drill_ids: Array.from(new Set([...retired, ...current])),
        drill_swaps: (pres.drill_swaps || 0) + 1,
      })
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)

    if (upErr) throw upErr

    const swaps = (pres.drill_swaps || 0) + 1

    return NextResponse.json({
      drills: finalDrills,
      swaps,
      // Said once, at the point it becomes true, rather than buried in a doc.
      readWarning: swaps >= 2
        ? 'That is the second set of drills on this priority. If the work is getting done and nothing is moving, the problem is usually the read, not the drills — worth giving an update so it can look again at the cause.'
        : null,
    })
  } catch (error: any) {
    console.error('Priority drills POST error:', error)
    return NextResponse.json({ error: error.message || 'Could not find different drills' }, { status: 500 })
  }
}


// gatherCandidates() and rankByFit() used to live here. They now live in
// lib/drillRetrieval.ts, because the player development report needs the same
// retrieval and a second copy of it would have meant two recommenders drifting
// apart while both claimed to be "the BenchCoach library".

// ---------------------------------------------------------------------------
// PATCH { prescriptionId, coachId, replaceDrillId, withDrillId }
//   — the coach picked one of the options for a slot
// ---------------------------------------------------------------------------
// Slot-level, so the other drills keep their position. Swapping the whole set
// to change one of them is how a coach loses the two they liked.
export async function PATCH(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const { prescriptionId, coachId, replaceDrillId, withDrillId } = await request.json()
    if (!prescriptionId || !coachId || !withDrillId) {
      return NextResponse.json(
        { error: 'prescriptionId, coachId and withDrillId are required' },
        { status: 400 }
      )
    }

    const { data: p } = await supabaseAdmin
      .from('prescriptions')
      .select('id, drill_ids, retired_drill_ids, drill_swaps')
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const pres = p as any

    const current: string[] = pres.drill_ids || []
    const retired: string[] = pres.retired_drill_ids || []

    // Replace in place when we know which slot; append when the coach is
    // adding rather than swapping.
    const next = replaceDrillId && current.includes(replaceDrillId)
      ? current.map(id => (id === replaceDrillId ? withDrillId : id))
      : [...current, withDrillId]

    const { data: updated, error } = await supabaseAdmin
      .from('prescriptions')
      .update({
        drill_ids: Array.from(new Set(next)),
        retired_drill_ids: replaceDrillId
          ? Array.from(new Set([...retired, replaceDrillId]))
          : retired,
        // One swap is one swap regardless of how many options were shown.
        drill_swaps: replaceDrillId ? (pres.drill_swaps || 0) + 1 : (pres.drill_swaps || 0),
      })
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .select('drill_ids, drill_swaps')
      .single()

    if (error) throw error
    const swaps = (updated as any).drill_swaps || 0

    return NextResponse.json({
      drillIds: (updated as any).drill_ids || [],
      swaps,
      readWarning: swaps >= 2
        ? 'That is the second drill change on this priority. If the work is getting done and nothing is moving, the problem is usually the read rather than the drills — worth sending an update so it can look again at the cause.'
        : null,
    })
  } catch (error: any) {
    console.error('Priority drill swap error:', error)
    return NextResponse.json({ error: error.message || 'Could not swap the drill' }, { status: 500 })
  }
}
