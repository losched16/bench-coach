import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  generatePracticePlanSingle, generatePracticeSkeleton, expandPracticeBlock,
  PracticeInputs, TeamContext,
} from '@/lib/anthropic'
import { assembleCoachContext, renderCoachContext } from '@/lib/coachContext'
import { categoriesForPracticeFocus } from '@/lib/focusAreas'
import { guard } from '@/lib/authz'
import { visibleDrillsSafe, favoriteDrillIds, drillMenuLine, DRILL_PREFERENCE_NOTE } from '@/lib/drills'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Vision and generation calls take real time now that thinking is on by
// default. Without this the platform kills the function at its 15s default
// and the user sees a failure that has nothing to do with their input.
export const maxDuration = 180

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const { teamId, duration, focus, constraints, isRefine } = await request.json()

    if (!teamId || !duration || !focus) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Load team context
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Started now, awaited at the bottom. Nothing between here and there
    // needs it, and it is the longest query on the route.
    const loopContextPromise = assembleCoachContext(supabaseAdmin, {
      coachId: team.coach_id,
      teamId,
    })
      .then(ctx =>
        (ctx.activePrescriptions?.length || ctx.observations?.length)
          ? renderCoachContext(ctx)
          : ''
      )
      .catch((e: any) => {
        // The plan is still worth generating without it.
        console.warn('Practice plan: loop context unavailable:', e?.message)
        return ''
      })

    // Load team notes
    const { data: teamNotes } = await supabaseAdmin
      .from('team_notes')
      .select('note')
      .eq('team_id', teamId)
      .eq('pinned', true)
      .limit(3)

    // Load recent practice recaps (last 3) to feed into the next plan.
    //
    // Two attempts. The recap columns arrived in migration 038, and before it
    // this select failed on the first unknown column, dropped into the catch
    // below, and logged a warning nobody reads — so the whole recaps-improve-
    // the-next-plan loop was off with no visible symptom. Falling back to the
    // columns that have always existed means a database without 038 still gets
    // the coach's own notes into the plan.
    let recapContext = ''
    let recapsDegraded = false
    // How many kids actually turned up recently. The single most useful number
    // for planning a practice and, until migration 038, one nothing recorded.
    let attendanceHistory: number[] = []
    try {
      const recapQuery = (full: boolean) => supabaseAdmin
        .from('practice_sessions')
        .select(full
          ? 'date, recap_note, what_worked, what_didnt_work, player_callouts, energy_level, next_focus, attendance_count'
          : 'date, recap_note')
        .eq('team_id', teamId)
        .order('date', { ascending: false })
        .limit(3)

      let attempt = await recapQuery(true)
      if (attempt.error) {
        recapsDegraded = true
        attempt = await recapQuery(false)
      }
      const recentRecaps = attempt.data as any[] | null

      attendanceHistory = (recentRecaps || [])
        .map(r => r.attendance_count)
        .filter((n: any) => typeof n === 'number' && n > 0)

      if (recentRecaps && recentRecaps.length > 0) {
        const recapLines = recentRecaps.map(r => {
          const parts: string[] = []
          parts.push(`Practice on ${r.date}:`)
          if (r.energy_level) parts.push(`  Energy: ${r.energy_level}`)
          if (r.attendance_count) parts.push(`  Attendance: ${r.attendance_count} players`)
          if (r.what_worked && (r.what_worked as string[]).length > 0) {
            parts.push(`  ✅ What worked: ${(r.what_worked as string[]).join(', ')}`)
          }
          if (r.what_didnt_work && (r.what_didnt_work as string[]).length > 0) {
            parts.push(`  ⚠️ What didn't work: ${(r.what_didnt_work as string[]).join(', ')}`)
          }
          if (r.player_callouts && (r.player_callouts as any[]).length > 0) {
            const callouts = (r.player_callouts as any[])
              .map(c => `${c.player_name}: ${c.note} (${c.type})`)
              .join('; ')
            parts.push(`  Player notes: ${callouts}`)
          }
          if (r.next_focus && (r.next_focus as string[]).length > 0) {
            parts.push(`  Coach wants next practice to focus on: ${(r.next_focus as string[]).join(', ')}`)
          }
          if (r.recap_note) parts.push(`  Notes: ${r.recap_note}`)
          return parts.join('\n')
        })

        recapContext = recapLines.join('\n\n')
      }
    } catch (e: any) {
      console.warn('Practice plan: recaps unavailable:', e?.message)
    }

    if (recapsDegraded) {
      // Named, so this shows up as something rather than nothing. The whole
      // reason it went unnoticed for so long is that its failure mode was a
      // console warning on a server nobody was watching.
      console.warn(
        'Practice plan: recap columns missing — run migrations/038_practice_recap_columns.sql. ' +
        'Plans are being generated without what worked, what did not, or the attendance count.'
      )
    }

    // Build constraints string that includes recaps
    let fullConstraints = constraints || ''
    if (recapContext) {
      fullConstraints += `\n\nRECENT PRACTICE RECAPS (use these to make this plan better):\n${recapContext}`
    }

    // Only the drills that could plausibly be in THIS practice. Sending all
    // 100 with their full coaching notes was tens of thousands of input tokens
    // per request, most of it about skills the coach did not pick — and it is
    // the single biggest reason this took so long.
    //
    // ai_coaching_notes and safety_notes are deliberately not selected: they
    // are long prose written for the drill page, and the model is choosing a
    // drill here, not running it.
    const wantedCategories = categoriesForPracticeFocus(focus)

    const DRILL_SELECT = 'id, drill_name, skill_category, description, youtube_video_id, channel, age_range, difficulty_level, mechanic_focus, equipment_needed, created_by_coach_id'

    // ilike-any rather than `in`, because the stored categories are
    // inconsistently cased.
    const narrow = (q: any) => {
      let out = q
      if (wantedCategories.length > 0) {
        out = out.or(wantedCategories.map(c => `skill_category.ilike.${c}`).join(','))
      }
      return out.limit(45)
    }

    const matchedResult = await visibleDrillsSafe(
      supabaseAdmin, team.coach_id, DRILL_SELECT, narrow
    )
    const matched = matchedResult.data
    let drillsDegraded = matchedResult.degraded

    // Loud, because the failure mode here is a plan generated with an empty
    // drill library — which produces a worse plan and no error at all.
    if (matchedResult.error) {
      console.error('Practice plan: drill library query failed:', matchedResult.error)
    }

    // Which of these the coach has starred. Favourites are a preference the
    // model is told about, not a filter — a coach with four favourites should
    // still get a full practice.
    const favorites = await favoriteDrillIds(supabaseAdmin, team.coach_id)

    // A focus with no library coverage (confidence, focus/behavior) would
    // otherwise send nothing at all, and the plan loses its videos.
    let drillResources = matched
    if (!matched || matched.length < 8) {
      const wide = await visibleDrillsSafe(
        supabaseAdmin, team.coach_id, DRILL_SELECT, (q: any) => q.limit(45)
      )
      if (wide.error) {
        console.error('Practice plan: fallback drill query failed:', wide.error)
      }
      drillResources = wide.data
      drillsDegraded = drillsDegraded || wide.degraded
    }

    if (drillsDegraded) {
      console.warn(
        'Practice plan: drill_resources has no created_by_coach_id — run ' +
        'migrations/041_coach_drills_and_favorites.sql. Favourites and ' +
        "coach-written drills are off; the curated library still works."
      )
    }

    // Who is actually going to be standing there.
    //
    // players was hardcoded to [] since this route was written, so every plan
    // ever generated was written for an unknown number of kids. "Split into
    // stations" is useless advice; "three groups of four" is a plan. This is
    // the difference, and it costs one query.
    let roster: Array<{ id: string; name: string }> = []
    try {
      const { data: rosterRows } = await supabaseAdmin
        .from('team_players')
        .select('player_id, player:players(id, name)')
        .eq('team_id', teamId)

      roster = (rosterRows || [])
        .map((r: any) => {
          const p = Array.isArray(r.player) ? r.player[0] : r.player
          return p ? { id: p.id, name: p.name } : null
        })
        .filter(Boolean) as Array<{ id: string; name: string }>
    } catch (e: any) {
      console.warn('Practice plan: roster unavailable:', e?.message)
    }

    // Deliberately names and a count, not full player profiles. Sending every
    // kid's six skill ratings would repeat the mistake the drill library
    // already had to be cured of — the model is doing station maths and
    // planning around a couple of specific kids, not writing a scouting
    // report on each one.
    let rosterSection = ''
    if (roster.length > 0) {
      const typical = attendanceHistory.length > 0
        ? Math.round(attendanceHistory.reduce((a, b) => a + b, 0) / attendanceHistory.length)
        : null

      rosterSection =
        `HOW MANY KIDS\n\n` +
        `Roster: ${roster.length} players — ${roster.map(p => p.name).join(', ')}.\n` +
        (typical
          ? `Recent attendance: ${attendanceHistory.join(', ')}. Plan for about ${typical}.\n`
          : `No attendance recorded yet, so plan for the full ${roster.length} and say what to cut if fewer show up.\n`) +
        `\nDo the station maths against that number and put it in the plan. ` +
        `"Three groups of four, rotating every four minutes" — never "split into stations". ` +
        `No kid should stand in a line waiting more than about thirty seconds; ` +
        `if a block would leave players idle at this headcount, change the block.`
    }

    // Favourites and the coach's own drills, said once so the model knows what
    // the marks in the menu mean.
    const drillPreference = (drillResources || []).some((d: any) =>
      favorites.has(d.id) || d.created_by_coach_id
    ) ? DRILL_PREFERENCE_NOTE : ''

    // Build context
    const context: TeamContext = {
      team: {
        name: team.name,
        age_group: team.age_group,
        skill_level: team.skill_level,
        practice_duration_minutes: team.practice_duration_minutes,
        primary_goals: team.primary_goals || [],
      },
      coachPreferences: {},
      teamNotes: teamNotes?.map(n => ({ note: n.note, pinned: true })) || [],
      players: roster.map(p => ({ name: p.name })),
    }

    // What the loop knows: active team priorities, what the coach logged, and
    // any check-in outcomes. The practice builder used to be blind to all of
    // it, so a plan could cheerfully re-prescribe a drill the check-in had
    // just concluded wasn't working.
    //
    // Awaited here, but STARTED much earlier — see loopContextPromise. It is
    // the slowest thing on this route by some distance and it does not depend
    // on anything below it, so waiting for it in sequence was several seconds
    // of the coach staring at "Picking the drills…".
    const loopContext = await loopContextPromise

    // Streamed as progress lines, then the finished plan. The client waited on
    // a single JSON response before, so a 40-second generation was 40 seconds
    // of nothing — which is what "taking way too long" mostly was.
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: any) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))

        const inputs: PracticeInputs = {
          duration,
          focus,
          context,
          constraints: fullConstraints,
          drillResources: drillResources || [],
          loopContext: loopContext || undefined,
          rosterSection: rosterSection || undefined,
          preference: { favorites, note: drillPreference },
        }

        try {
          // A refine is one coherent rewrite of a plan the coach has already
          // read, so it stays a single call — fanning it out would let five
          // independent expansions disagree about what changed.
          if (isRefine) {
            const plan = await generatePracticePlanSingle(
              duration, focus, context, fullConstraints, drillResources || [],
              loopContext || undefined, rosterSection || undefined,
              { favorites, note: drillPreference }
            )
            send({ type: 'plan', plan })
            controller.close()
            return
          }

          // Phase 1: the shape. Small output, so it lands in seconds, and the
          // coach can see the whole practice — including the flags — while the
          // detail is still being written.
          const skeleton = await generatePracticeSkeleton(inputs)
          const blocks: any[] = Array.isArray(skeleton.blocks) ? skeleton.blocks : []
          send({ type: 'skeleton', plan: { ...skeleton, blocks } })

          // Phase 2: every block at once. Wall clock is the slowest block, not
          // the sum of them, and each call has room to be thorough about one
          // block instead of rationing tokens across the whole plan.
          const expanded = await Promise.all(
            blocks.map((b, idx) =>
              expandPracticeBlock(inputs, b, idx, blocks)
                .then(detail => {
                  const full = { ...b, ...detail }
                  // Sent as it lands so the coach can start reading block one
                  // while block four is still being written.
                  send({ type: 'block', index: idx, block: full })
                  return full
                })
                .catch((e: any) => {
                  // One block failing must not cost the plan. The skeleton
                  // version of it is still runnable — it has a name, a
                  // duration and a description.
                  console.error(`Practice plan: block ${idx} expansion failed:`, e?.message)
                  send({ type: 'block', index: idx, block: b })
                  return b
                })
            )
          )

          send({ type: 'plan', plan: { ...skeleton, blocks: expanded } })
        } catch (e: any) {
          console.error('Practice plan generation error:', e)
          send({ type: 'error', error: e?.message || 'Failed to generate practice plan' })
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })

  } catch (error: any) {
    console.error('Practice plan API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
