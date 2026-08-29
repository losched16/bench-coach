import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  generatePracticeSkeleton, expandPracticeBlock,
  PracticeInputs, TeamContext,
} from '@/lib/anthropic'
import { assembleCoachContext, renderCoachContext } from '@/lib/coachContext'
import { categoriesForPracticeFocus } from '@/lib/focusAreas'
import { guard } from '@/lib/authz'
import { visibleDrillsSafe, favoriteDrillIds, drillMenuLine, DRILL_PREFERENCE_NOTE, DRILL_FIELDS } from '@/lib/drills'
import { reusableBlock } from '@/lib/practicePlan'
import { describeClaudeFailure, logClaudeFailure } from '@/lib/claudeClient'
import { retrieveDrills } from '@/lib/drillRetrieval'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
import {
  computeBudget, schedulePractice, describeSchedule, fitBlocks, estimateBlockCount,
} from '@/lib/practiceScheduler'

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
    const {
      teamId, duration, focus, constraints, isRefine,
      // Drills the coach picked out of their favorites before generating.
      // Not a hint — the plan is built around these.
      mustIncludeDrillIds,
      // The coach's own #1 goal for the night, and what they have in the car.
      // Both optional: a blank objective means the model decides and writes
      // one back, and an empty equipment list means "assume the usual kit"
      // rather than "they have nothing".
      objective, equipmentAvailable,
      // On a rebuild, the plan they just read. Blocks they did not ask to
      // change keep the detail that was already written for them instead of
      // being generated again.
      previousBlocks,
    } = await request.json()

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

    // Which drills could plausibly be in THIS practice.
    //
    // This used to be `skill_category ilike any(...)` with `.limit(45)`, which
    // had two problems beyond being a second implementation of drill selection.
    // The taxonomy was invisible to it, so a coach whose focus was "hitting"
    // got 45 arbitrary hitting drills rather than the ones that fix the thing
    // they actually described. And `.limit(45)` is applied by PostgREST before
    // any ordering, so WHICH 45 was down to physical row order — the same
    // class of bug as the hundred-row ceiling chat used to have.
    //
    // It now goes through the shared retrieval layer, the same one chat uses:
    // taxonomy first, then category, then text, with age and operational
    // filtering, coach scoping and deterministic tiebreaks all decided in one
    // place. Nothing about scoring or filtering is reimplemented here.
    const wantedCategories = categoriesForPracticeFocus(focus)

    // What the coach is actually trying to fix, in their words. The focus
    // areas alone are categories; the objective and the constraints box are
    // where "he keeps dropping his back shoulder" gets typed, and that is the
    // sentence the taxonomy can diagnose.
    const retrievalQuery = [
      typeof objective === 'string' ? objective : '',
      typeof constraints === 'string' ? constraints : '',
      focus.join(', '),
    ].filter(Boolean).join('. ')

    // Read out of the same free text. Absence stays absence — a coach who did
    // not mention a gym is not asking for indoor drills, and must not have
    // outdoor drills filtered away on a guess.
    const textConstraints = constraintsFromText(retrievalQuery)

    // Which of these the coach has starred. Favorites are a preference the
    // model is told about, not a filter — a coach with four favorites should
    // still get a full practice.
    const favorites = await favoriteDrillIds(supabaseAdmin, team.coach_id)

    // Deeper than chat's dozen: a 120-minute practice needs enough candidates
    // to fill six blocks without repeating itself, and the scheduler drops
    // redundant and over-budget entries out of this pool rather than being
    // handed exactly as many as will fit.
    const RETRIEVAL_LIMIT = 30

    let drillsDegraded = false
    let retrieval: Awaited<ReturnType<typeof retrieveDrills>> | null = null
    try {
      retrieval = await retrieveDrills({
        supabase: supabaseAdmin,
        coachId: team.coach_id,
        query: retrievalQuery,
        categories: wantedCategories,
        // The team's age band, not a number typed by anyone — "10U" is what
        // the product stores and what a coach thinks in.
        playerAge: ageFromText(String(team.age_group || '')),
        indoorOutdoor: textConstraints.indoorOutdoor,
        spaceAvailable: textConstraints.spaceAvailable,
        availableEquipment: Array.isArray(equipmentAvailable) && equipmentAvailable.length
          ? equipmentAvailable : null,
        favorites,
        limit: RETRIEVAL_LIMIT,
      })
    } catch (e: any) {
      // Retrieval reaches the model to diagnose the coach's sentence. If that
      // is unavailable the practice is still worth generating, so fall through
      // to the library-wide query below rather than failing the request.
      console.error('Practice plan: shared retrieval failed:', e?.message)
    }

    let drillResources: any[] | null = retrieval ? retrieval.drills : null

    // A focus with no library coverage (confidence, focus/behavior) would
    // otherwise send nothing at all, and the plan loses its videos.
    //
    // The ceiling here is deliberately the whole visible library rather than a
    // number: this is the "we found almost nothing" path, and capping it at 45
    // was how a fallback meant to widen the pool ended up narrowing it.
    if (!drillResources || drillResources.length < 8) {
      const wide = await visibleDrillsSafe(
        supabaseAdmin, team.coach_id, DRILL_FIELDS, (q: any) => q.limit(500)
      )
      if (wide.error) {
        console.error('Practice plan: fallback drill query failed:', wide.error)
      }
      drillResources = wide.data
      drillsDegraded = wide.degraded
    }

    // Drills the coach explicitly asked for.
    //
    // Fetched separately and merged in, because the menu above is filtered to
    // the chosen focus areas — a coach picking a favorite hitting drill for a
    // fielding practice would otherwise have it silently dropped before the
    // model ever saw it, which is the opposite of "I picked this one".
    let mustUse: any[] = []
    const wantedIds: string[] = Array.isArray(mustIncludeDrillIds) ? mustIncludeDrillIds : []
    if (wantedIds.length > 0) {
      const picked = await visibleDrillsSafe(
        supabaseAdmin, team.coach_id, DRILL_FIELDS,
        (q: any) => q.in('id', wantedIds)
      )
      if (picked.error) {
        console.error('Practice plan: picked drills query failed:', picked.error)
      }
      mustUse = picked.data || []

      const byId = new Map<string, any>()
      for (const d of [...(drillResources || []), ...mustUse]) {
        if (d?.id) byId.set(d.id, d)
      }
      drillResources = Array.from(byId.values())
    }

    if (drillsDegraded) {
      console.warn(
        'Practice plan: drill_resources has no created_by_coach_id — run ' +
        'migrations/041_coach_drills_and_favorites.sql. Favorites and ' +
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

    // Favorites and the coach's own drills, said once so the model knows what
    // the marks in the menu mean.
    let drillPreference = (drillResources || []).some((d: any) =>
      favorites.has(d.id) || d.created_by_coach_id
    ) ? DRILL_PREFERENCE_NOTE : ''

    // Said last so it is the strongest thing in the section. A coach who ticked
    // a drill has made a decision, and a plan that quietly drops it has
    // overruled them.
    if (mustUse.length > 0) {
      drillPreference +=
        `\n\nTHE COACH HAS CHOSEN THESE DRILLS AND EVERY ONE MUST BE IN THE PLAN:\n` +
        mustUse.map((d: any) => `- "${d.drill_name}"`).join('\n') +
        `\nBuild the practice around them. If one does not fit the focus areas, ` +
        `it still goes in — put it where it does the most good and say in that ` +
        `block's description why it is there. Do not silently drop one, and do ` +
        `not substitute something similar.`
    }

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

    // How much of the requested time is actually available for drills, and
    // which of the retrieved drills fit into it.
    //
    // This is a RECOMMENDATION to the generator, not a plan. The model still
    // decides the practice — it knows things the scheduler does not, like that
    // the coach said they have a game on Saturday — and the arithmetic is
    // checked again on the way out. But a model told "you have 34 minutes of
    // drill time and these six drills fit it" writes a better practice than
    // one told "durations must add to about 60 minutes" and left to guess.
    //
    // Duration deliberately plays no part in retrieval, only here. Phase 2B
    // verified that populating est_duration_minutes changes nothing about
    // which drills rank where, and that separation is worth keeping: a
    // 5-minute drill should never beat a better 15-minute one on relevance.
    const blockCount = estimateBlockCount(duration)
    const budget = computeBudget(duration, { blockCount })
    const schedule = retrieval
      ? schedulePractice({ candidates: retrieval.scored, budget })
      : null

    // Observational only — a weak duration estimate never disqualifies a
    // drill. Logged so the drills the planner actually leans on can be the
    // first ones to get real rep counts written into them, rather than
    // hand-editing all 134 blind.
    if (schedule) {
      const noDuration = schedule.rejected.filter(r => r.reason === 'no-duration')
      if (noDuration.length > 0) {
        console.warn(
          `Practice plan: ${noDuration.length} retrieved drills have no est_duration_minutes ` +
          `and could not be time-scheduled — run migrations/047_drill_durations.sql. ` +
          noDuration.slice(0, 5).map(r => `"${r.drill.drill_name}"`).join(', ')
        )
      }
    }

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
          objective: typeof objective === 'string' && objective.trim()
            ? objective.trim() : undefined,
          equipmentAvailable: Array.isArray(equipmentAvailable) && equipmentAvailable.length
            ? equipmentAvailable : undefined,
          scheduleGuidance: schedule ? describeSchedule(schedule) : undefined,
        }

        // Sent before anything is awaited, so bytes are on the wire within
        // milliseconds. A refine used to await one 60-120 second generation
        // and send nothing until it finished; the gateway saw an open response
        // with no data, killed it, and the coach got a 504 with no idea why.
        // Whatever else changes here, something must be written immediately.
        send({ type: 'progress', stage: isRefine ? 'rebuilding' : 'designing' })

        try {
          // Phase 1: the shape. Small output, so it lands in seconds, and the
          // coach can see the whole practice — including the flags — while the
          // detail is still being written.
          //
          // A refine runs through here too. It used to be a single call on the
          // grounds that fanning out would let independent expansions disagree
          // about what changed — but they never see "what changed". The
          // skeleton is one call that reads the old plan and the coach's words
          // and decides the whole new shape; the expansions just write out the
          // blocks they are handed.
          const skeleton = await generatePracticeSkeleton(inputs)
          const rawBlocks: any[] = Array.isArray(skeleton.blocks) ? skeleton.blocks : []

          // Make the arithmetic true.
          //
          // The generator is asked for durations that add to "about" the
          // requested minutes, and mostly complies. Mostly is not a contract,
          // and a 60-minute request coming back as 72 minutes of blocks is a
          // coach running fifteen minutes over in the dark with parents
          // waiting. Nothing counted before this.
          //
          // Trims proportionally first so every block keeps its shape and its
          // place, and only drops blocks when trimming alone cannot get there.
          const fitted = fitBlocks(rawBlocks, duration)
          if (fitted.adjustments.length > 0) {
            console.warn(
              `Practice plan: schedule corrected for team ${teamId} — ${fitted.adjustments.join('; ')}`
            )
          }
          const blocks = fitted.blocks

          send({ type: 'skeleton', plan: { ...skeleton, blocks } })

          // On a rebuild, a block that came back with the same name and the
          // same length is the one the coach already read and did not complain
          // about. Its detail is reused verbatim rather than regenerated —
          // which is both faster and the only way "keep what I liked" can
          // actually hold. Asking the model to keep it "as close to identical
          // as you can" was never a guarantee.
          const prior: any[] = isRefine && Array.isArray(previousBlocks) ? previousBlocks : []

          // Phase 2: every block that still needs writing, at once. Wall clock
          // is the slowest block, not the sum of them.
          const expanded = await Promise.all(
            blocks.map((b, idx) => {
              const kept = prior.length ? reusableBlock(b, prior) : null
              if (kept) {
                send({ type: 'block', index: idx, block: kept })
                return Promise.resolve(kept)
              }
              return expandPracticeBlock(inputs, b, idx, blocks)
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
            })
          )

          send({ type: 'plan', plan: { ...skeleton, blocks: expanded } })
        } catch (e: any) {
          console.error('Practice plan generation error:', e)
          logClaudeFailure('practice-plan', e)
          send({ type: 'error', error: describeClaudeFailure(e)?.message || e?.message || 'Failed to generate practice plan' })
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
