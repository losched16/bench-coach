import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { COACH_VOICE } from '@/lib/coachVoice'
import { assembleCoachContext, renderCoachContext } from '@/lib/coachContext'
import { focusAreaLabel } from '@/lib/focusAreas'
import { migrationHintFor } from '@/lib/migrationHints'
import { guard } from '@/lib/authz'

// The personal development plan.
//
// A priority says what to fix and hands over drills. This says what to do on
// Tuesday: how long, how many, in what order, and what "better" looks like by
// Saturday. That gap is where the loop leaks — a parent can agree with the
// read, have the drills open on their phone, and still not know how to spend
// twenty minutes in a driveway.
//
// It is written against ONE priority and stored on it, because it dies when
// that priority closes. A plan that outlives its reason is a plan nobody
// trusts.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Long generation, streamed. Without this the platform kills it mid-plan.
export const maxDuration = 300

const PLAN_MODEL = 'claude-opus-5'

// Three weeks because that is the priority's own window — the plan and the
// check-in have to end on the same day or the review has nothing to judge.
const DEFAULT_WEEKS = 3

const PLAN_SYSTEM = `${COACH_VOICE}

WHAT THIS SURFACE IS

You are writing a three-week development plan for ONE player, for the parent or coach who will actually run it. They may have twenty minutes in a driveway, a bucket of balls, and a kid who would rather be inside.

This is not a list of drills. They already have the drills. This is the schedule and the method: which drill on which day, how many reps, in what order, what to say, and how to tell it worked.

HARD RULES

1. Fit a real week. Two or three sessions of 15-25 minutes. If you write a plan that needs an hour four times a week, it will not happen and the check-in will read as failure when it was your fault.

2. Every session is specific. "Tee work" is not a session. "3 rounds of 8 off the tee at belt height, outside third, freeze at contact on the last one of each round" is a session.

3. Progress the difficulty across the weeks. Week 1 is the movement in isolation, slow and unopposed. Week 2 adds timing or a decision. Week 3 puts it under something like game pressure. If a skill does not progress that way, say what the actual progression is and use that instead.

4. Name what to look for, not what to hope for. "You'll see him staying back" is useless. "By the end of week 2 he should be able to take a ball on the outside third to the opposite field on 3 of 8" is a thing a parent can check.

5. Say what to do when it is not working. Every plan meets a week where the kid is frustrated or the movement gets worse before it gets better. Name the most likely one and what to do about it.

6. Never mention what they failed to log. If there is little history, write the plan and move on.

7. Equipment they do not have does not exist. If the drills need a net and nothing says they own one, give the no-net version.

STRUCTURE

Use these exact H2 headings, in this order:

## The shape of it
Two or three sentences: what the three weeks are doing and why in that order. Name the progression.

## Week 1
The sessions. For each: what to run, how long, how many, what to say, and what a good rep looks like.

## Week 2
Same, harder or with a decision added. Say what changed from week 1 and why.

## Week 3
Same, under pressure. Say what "ready" looks like.

## How to tell it's working
The observable checks, by week. Concrete enough that a parent standing behind a kid can answer yes or no.

## When it goes sideways
The most likely failure and the fix. One or two, not a list.

Write it now. No preamble, no sign-off.`

// ---------------------------------------------------------------------------
// GET ?prescriptionId=&coachId= — the plan, if one has been written
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
    const { data, error } = await supabaseAdmin
      .from('prescriptions')
      .select('development_plan, drill_ids')
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (error) throw error

    const plan = (data as any)?.development_plan || null
    // A plan written around drills that have since been swapped is telling a
    // parent to run something that is no longer the plan. Say so rather than
    // silently serving a stale document.
    const builtFrom: string[] = plan?.drill_ids || []
    const now: string[] = (data as any)?.drill_ids || []
    const stale = !!plan && builtFrom.length > 0 &&
      (builtFrom.length !== now.length || builtFrom.some(id => !now.includes(id)))

    return NextResponse.json({ plan, stale })
  } catch (error: any) {
    console.error('Development plan GET error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json({
      plan: null,
      needsMigration: !!hint,
      migrationMessage: hint?.message || null,
    })
  }
}

// ---------------------------------------------------------------------------
// POST { prescriptionId, coachId } — write it, stream it, save it
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const { prescriptionId, coachId } = await request.json()

    if (!prescriptionId || !coachId) {
      return NextResponse.json({ error: 'prescriptionId and coachId required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const { data: pres } = await supabaseAdmin
      .from('prescriptions')
      .select('*')
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (!pres) return NextResponse.json({ error: 'Priority not found' }, { status: 404 })
    const p = pres as any

    if (p.scope === 'team') {
      return NextResponse.json(
        { error: 'Team priorities get a practice plan, not a development plan.' },
        { status: 400 }
      )
    }

    // Who this is for, and how old — a plan for a nine-year-old and a plan for
    // a fourteen-year-old are different documents.
    let playerName = 'this player'
    let playerAge: number | null = null
    if (p.player_id) {
      const { data: player } = await supabaseAdmin
        .from('players').select('name, birth_year').eq('id', p.player_id).maybeSingle()
      if (player) {
        playerName = (player as any).name || playerName
        if ((player as any).birth_year) {
          playerAge = new Date().getFullYear() - (player as any).birth_year
        }
      }
    }

    // The drills that survived review. If the coach threw them all out, say so
    // rather than writing a plan around drills that aren't there.
    const drillIds: string[] = p.drill_ids || []
    const { data: drills } = drillIds.length
      ? await supabaseAdmin
          .from('drill_resources')
          .select('id, drill_name, description, equipment_needed, reps_guidance, frequency_guidance, ai_coaching_notes, difficulty_level')
          .in('id', drillIds)
      : { data: [] as any[] }

    const ordered = drillIds.map(id => (drills || []).find((d: any) => d.id === id)).filter(Boolean) as any[]

    // Everything the loop knows about this kid — history, measurements, what
    // was logged. Same assembly the analysis and the chat use.
    let history = ''
    try {
      const ctx = await assembleCoachContext(supabaseAdmin, {
        coachId,
        teamId: p.team_id || null,
        playerId: p.player_id || null,
      })
      const rendered = renderCoachContext(ctx)
      if (rendered && !rendered.startsWith('No history logged')) history = rendered
    } catch {
      // A plan without history is thinner, not impossible.
    }

    const drillBlock = ordered.length
      ? ordered.map((d, i) =>
          `${i + 1}. ${d.drill_name}` +
          (d.difficulty_level ? ` (${d.difficulty_level})` : '') +
          (d.description ? `\n   ${d.description}` : '') +
          (d.reps_guidance ? `\n   Suggested reps: ${d.reps_guidance}` : '') +
          (d.frequency_guidance ? `\n   Suggested frequency: ${d.frequency_guidance}` : '') +
          (d.equipment_needed?.length ? `\n   Needs: ${d.equipment_needed.join(', ')}` : '') +
          (d.ai_coaching_notes ? `\n   Coaching notes: ${d.ai_coaching_notes}` : '')
        ).join('\n\n')
      : '(The coach set all the suggested drills aside. Build the plan around the priority itself — ' +
        'describe the work in plain terms they can run without a named drill from a library.)'

    const prompt = `Write a ${DEFAULT_WEEKS}-week development plan for ${playerName}${
      playerAge ? `, age ${playerAge}` : ''
    }.

THE PRIORITY (${focusAreaLabel(p.focus_area)}):
${p.priority || '(not recorded)'}

WHAT WE SAID TO WATCH FOR:
${p.success_criteria || '(no criteria recorded — set some in the plan)'}

${p.summary ? `OUR READ AT THE TIME:\n${p.summary}\n` : ''}
DRILLS THEY KEPT:
${drillBlock}

${history ? `WHAT WE KNOW ABOUT ${playerName.toUpperCase()}:\n${history}\n` : ''}
Write the plan.`

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let markdown = ''
        try {
          const gen = anthropic.messages.stream({
            model: PLAN_MODEL,
            max_tokens: 8000,
            system: PLAN_SYSTEM,
            messages: [{ role: 'user', content: prompt }],
            output_config: { effort: 'medium' },
          })

          for await (const event of gen) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const chunk = (event.delta as any).text as string
              markdown += chunk
              controller.enqueue(encoder.encode(chunk))
            }
          }

          if (markdown.trim()) {
            await supabaseAdmin
              .from('prescriptions')
              .update({
                development_plan: {
                  markdown,
                  weeks: DEFAULT_WEEKS,
                  generated_at: new Date().toISOString(),
                  // What it was written around, so a later drill swap can be
                  // detected and the plan flagged rather than quietly wrong.
                  drill_ids: drillIds,
                },
              })
              .eq('id', prescriptionId)
              .eq('coach_id', coachId)
          }
        } catch (e: any) {
          console.error('Development plan stream error:', e)
          controller.enqueue(encoder.encode(
            `\n\n_The plan stopped part-way through: ${e?.message || 'unknown error'}. Try again._`
          ))
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error: any) {
    console.error('Development plan POST error:', error)
    return NextResponse.json({ error: error.message || 'Could not write the plan' }, { status: 500 })
  }
}
