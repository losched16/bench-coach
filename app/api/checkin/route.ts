import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { COACH_VOICE } from '@/lib/coachVoice'
import {
  CheckinEvidence,
  VERDICT_SENTINEL,
  dueState,
  daysBetween,
  expectedSessions,
  readAdherence,
  gatherCheckinEvidence,
  renderCheckinEvidence,
  splitVerdict,
} from '@/lib/checkin'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Same reasoning as the analysis route: this is a long generation that streams.
export const maxDuration = 300

const CHECKIN_MODEL = 'claude-opus-5'
const CHECKIN_EFFORT = 'medium'

// ---------------------------------------------------------------------------
// GET
//   ?coachId=&teamId=            → active prescriptions + which are due
//   ?coachId=&prescriptionId=    → the evidence bundle + last check-in
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const teamId = searchParams.get('teamId')
  const prescriptionId = searchParams.get('prescriptionId')

  if (!coachId) {
    return NextResponse.json({ error: 'coachId required' }, { status: 400 })
  }

  try {
    if (prescriptionId) {
      const evidence = await gatherCheckinEvidence(supabaseAdmin, prescriptionId, coachId)
      if (!evidence) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      const { data: last } = await supabaseAdmin
        .from('checkins')
        .select('*')
        .eq('prescription_id', prescriptionId)
        .order('created_at', { ascending: false })
        .limit(1)
      return NextResponse.json({ evidence, lastCheckin: last?.[0] || null })
    }

    let q = supabaseAdmin
      .from('prescriptions')
      .select('id, scope, player_id, team_id, focus_area, priority, success_criteria, issued_at, review_due_at, min_hold_until, status')
      .eq('coach_id', coachId)
      .eq('status', 'active')
      .order('review_due_at', { ascending: true })
      .limit(25)

    if (teamId) q = q.eq('team_id', teamId)

    const { data: rows, error } = await q
    if (error) throw error

    const list = rows || []
    if (list.length === 0) return NextResponse.json({ prescriptions: [], dueCount: 0 })

    // Names and adherence counts in two queries rather than N.
    const playerIds = Array.from(new Set(list.map((p: any) => p.player_id).filter(Boolean)))
    const teamIds = Array.from(new Set(list.map((p: any) => p.team_id).filter(Boolean)))

    // Everything logged since the oldest open priority was issued. One query,
    // bucketed below — this is what tells us whether a check-in has anything
    // to check, which decides whether we ask for one at all.
    const earliestIssued = list
      .map((p: any) => (p.issued_at || '').slice(0, 10))
      .filter(Boolean)
      .sort()[0] || '1970-01-01'

    const [playersRes, teamsRes, sessionsRes, evidenceRes] = await Promise.all([
      playerIds.length
        ? supabaseAdmin.from('players').select('id, name').in('id', playerIds)
        : Promise.resolve({ data: [] as any[] }),
      teamIds.length
        ? supabaseAdmin.from('teams').select('id, name').in('id', teamIds)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin
        .from('entries')
        .select('prescription_id, occurred_on')
        .in('prescription_id', list.map((p: any) => p.id))
        .eq('entry_type', 'home_session'),
      supabaseAdmin
        .from('entries')
        .select('entry_type, occurred_on, player_id, team_id')
        .eq('coach_id', coachId)
        .gte('occurred_on', earliestIssued)
        .limit(500),
    ])

    const playerName: Record<string, string> = {}
    for (const p of (playersRes as any).data || []) playerName[p.id] = p.name
    const teamName: Record<string, string> = {}
    for (const t of (teamsRes as any).data || []) teamName[t.id] = t.name
    const sessionCount: Record<string, number> = {}
    const lastSessionOn: Record<string, string> = {}
    for (const s of (sessionsRes as any).data || []) {
      const pid = (s as any).prescription_id
      const on = (s as any).occurred_on as string
      sessionCount[pid] = (sessionCount[pid] || 0) + 1
      if (on && (!lastSessionOn[pid] || on > lastSessionOn[pid])) lastSessionOn[pid] = on
    }

    const allEntries = (evidenceRes as any).data || []

    const prescriptions = list.map((p: any) => {
      const scope: 'player' | 'team' = p.scope === 'team' ? 'team' : 'player'
      const days = daysBetween(p.issued_at)
      const logged = sessionCount[p.id] || 0
      const issuedDate = (p.issued_at || '').slice(0, 10)

      // Anything logged for this subject since we issued the priority is
      // something to read — a game counts even though it isn't adherence.
      const evidenceCount = allEntries.filter((e: any) =>
        e.occurred_on >= issuedDate &&
        (scope === 'player' ? e.player_id === p.player_id : e.team_id === p.team_id)
      ).length

      return {
        id: p.id,
        scope,
        focusArea: p.focus_area ?? null,
        subjectName: scope === 'player'
          ? (playerName[p.player_id] || 'this player')
          : (teamName[p.team_id] || 'this team'),
        teamId: p.team_id,
        playerId: p.player_id,
        priority: p.priority,
        successCriteria: p.success_criteria,
        issuedAt: p.issued_at,
        reviewDueAt: p.review_due_at,
        daysElapsed: days,
        due: dueState(p),
        adherence: readAdherence(logged, expectedSessions(scope, days)),
        lastSessionOn: lastSessionOn[p.id] || null,
        evidenceCount,
        // Asking someone to sit through a check-in that can only conclude
        // "I can't tell" is how a good feature teaches people to ignore it.
        hasEvidence: evidenceCount > 0,
      }
    })

    return NextResponse.json({
      prescriptions,
      dueCount: prescriptions.filter(p => p.due !== 'holding' && p.hasEvidence).length,
    })
  } catch (error: any) {
    console.error('Checkin GET error:', error)
    // Tables may not exist yet — the dashboard badge must not break the page
    return NextResponse.json({ prescriptions: [], dueCount: 0, needsMigration: true })
  }
}

// ---------------------------------------------------------------------------
// POST — write the check-in. Streams markdown, then a JSON verdict tail.
//   body: { coachId, prescriptionId }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { coachId, prescriptionId, coachUpdate } = await request.json()

    if (!coachId || !prescriptionId) {
      return NextResponse.json({ error: 'coachId and prescriptionId are required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    // An on-demand read carries the coach's own words as evidence, and they
    // outrank everything else in the bundle — they were at the field.
    const evidence = await gatherCheckinEvidence(supabaseAdmin, prescriptionId, coachId, coachUpdate)
    if (!evidence) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let raw = ''
        try {
          const gen = writeCheckin(evidence)
          for await (const event of gen) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const chunk = (event.delta as any).text as string
              raw += chunk
              controller.enqueue(encoder.encode(chunk))
            }
          }

          const { markdown, verdict } = splitVerdict(raw)

          const { data: saved } = await supabaseAdmin
            .from('checkins')
            .insert({
              coach_id: coachId,
              prescription_id: prescriptionId,
              markdown,
              verdict_status: verdict?.status || null,
              outcome_note: verdict?.outcome_note || null,
              next_focus: verdict?.next_focus || null,
              adherence_logged: evidence.adherence.logged,
              adherence_expected: evidence.adherence.expected,
              days_elapsed: evidence.daysElapsed,
              coach_update: evidence.coachUpdate || null,
            })
            .select('id')
            .single()

          // Generating the check-in clears the notification flag: they came and
          // looked, so there is nothing left to remind them about this week.
          await supabaseAdmin
            .from('prescriptions')
            .update({ last_checkin_notified_at: new Date().toISOString() })
            .eq('id', prescriptionId)

          controller.enqueue(encoder.encode(VERDICT_SENTINEL + JSON.stringify({
            checkinId: (saved as any)?.id || null,
            verdict,
            adherence: evidence.adherence,
          })))
        } catch (e: any) {
          console.error('Checkin stream error:', e)
          controller.enqueue(encoder.encode(VERDICT_SENTINEL + JSON.stringify({
            error: e?.message || 'The check-in stopped part-way through. Try again.',
          })))
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
    console.error('Checkin POST error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT — the coach acts on the check-in.
//   body: { coachId, prescriptionId, status, outcomeNote?, checkinId? }
//
// status 'active' means "give it longer" — we push the review window out
// another three weeks rather than asking again tomorrow.
// ---------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  try {
    const { coachId, prescriptionId, status, outcomeNote, checkinId } = await request.json()

    const allowed = ['active', 'resolved', 'stalled', 'abandoned']
    if (!coachId || !prescriptionId || !allowed.includes(status)) {
      return NextResponse.json(
        { error: 'coachId, prescriptionId and a valid status are required' },
        { status: 400 }
      )
    }

    const now = new Date()
    const update: Record<string, any> = {
      status,
      outcome_note: outcomeNote || null,
    }

    if (status === 'active') {
      // Extended, not closed. Reset both windows so the loop keeps its rhythm.
      const next = new Date(now.getTime() + 21 * 86_400_000).toISOString()
      update.review_due_at = next
      update.min_hold_until = next
      update.last_checkin_notified_at = now.toISOString()
    } else {
      update.resolved_at = now.toISOString()
    }

    const { error } = await supabaseAdmin
      .from('prescriptions')
      .update(update)
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)

    if (error) throw error

    if (checkinId) {
      await supabaseAdmin
        .from('checkins')
        .update({ accepted_at: now.toISOString(), verdict_status: status, outcome_note: outcomeNote || null })
        .eq('id', checkinId)
        .eq('coach_id', coachId)
    }

    return NextResponse.json({ success: true, status })
  } catch (error: any) {
    console.error('Checkin PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// The written check-in.
//
// Same voice and the same depth standard as the analysis — a coach should not
// be able to tell that a different prompt wrote it. The one thing this surface
// does that no other does is judge its own earlier work, which means it has to
// be willing to say "we were wrong about the cause".
// ---------------------------------------------------------------------------

const CHECKIN_SYSTEM = `${COACH_VOICE}

YOU ARE CHECKING YOUR OWN WORK

Three weeks ago you told this coach one thing to work on and stated in advance what improvement would look like. Now you are looking at what actually got logged and saying whether it moved.

Three rules specific to this job:

1. Judge against the criteria you set, not against a new standard. If you said "more balls hit to the right side" and there are more balls to the right side, that is a win even if the batting average went down. Do not move the goalposts.

2. Be willing to be wrong. "We had the cause wrong — the timing was fine, it's the front shoulder" is the most valuable sentence you can write. Never defend the earlier read because it was yours.

3. Never make the coach feel bad about what they did not log. If the sessions did not happen, the plan asked for something that did not fit into a real week with a job and two other kids. That is a plan problem and you fix it by making the ask smaller — not by mentioning what they missed. Do not write any sentence that reads as a reminder about compliance.

4. Stay in your area. This player may have priorities running in hitting, pitching, fielding and athleticism at the same time — that is normal, they are different skills worked in different slots, and they do not compete. Judge the one in front of you. Do not comment on the others and do not suggest dropping anything to make room.

If there genuinely is not enough evidence to call it, say so in one sentence and say exactly what one piece of information would settle it. That is a real answer. Padding it out with maybes is not.`

function writeCheckin(ev: CheckinEvidence) {
  const scopeWord = ev.prescription.scope === 'team' ? 'team' : 'player'

  const prompt = `Here is everything logged since we issued this prescription.

${renderCheckinEvidence(ev)}

---

Write the check-in. Use exactly these four H2 headings, in this order, and nothing outside them. Then the verdict block described at the end.

## Where this started
Two or three sentences. What we flagged, when, and what we said we would watch for. Written for someone who has not looked at this since — they should not have to go back and read the original.

## What's happened since
The evidence, with signal separated from noise. Say plainly what changed and what did not, and be explicit about sample size: a handful of at-bats is an observation, not a trend. If the coach's notes and the numbers disagree, trust the notes and say why. Weave the sessions in as information about what we can conclude — never as a tally of what was or was not done.

## The read
Did it move? Commit to an answer: it moved, it did not move, or there is not enough here to tell and here is the one thing that would settle it. Then say what that means for what happens next, using the adherence reading above — the difference between "the work was done and it didn't help" and "we don't know if the work happened" leads to two completely different next steps, and you must not blur them. If we had the cause wrong, say so directly.

## Next three weeks
${ev.prescription.scope === 'team'
  ? 'One practice block, concretely enough to run. If we are keeping the same priority, say what changes about how it is worked — the same block again for three more weeks is not a plan.'
  : 'Either the same priority worked differently, or a new one. Two home sessions a week, 10-15 minutes each, described concretely enough to run without watching a video first. Every cue must name a position or a movement the coach can see and correct — "hinge into the back hip and hold it a beat", not "get in a good position". If the sessions did not happen last time, make this ask visibly smaller than the last one and do not comment on why.'}
End with one line: what to watch for over the next three weeks, specific enough to be wrong.

Then, on a new line, output exactly:
${VERDICT_SENTINEL.trim()}
followed by a JSON object and nothing else:
{"status": "...", "outcome_note": "...", "next_focus": "..."}

status must be one of:
  "resolved"  — the criteria were met. It moved.
  "active"    — genuinely too early or not enough evidence; keep the same priority running. This is a normal answer at three weeks, especially for a ${scopeWord} this age.
  "stalled"   — enough time and enough evidence, and it did not move. Something has to change.
  "abandoned" — this stopped being the right priority (the season ended, the player moved positions, a lesson diagnosis replaced it).
outcome_note: one sentence, plain English, the thing a coach would say to another coach about how this went.
next_focus: the priority for the next three weeks, in one short phrase. Null if it is unchanged.

Write it now. No preamble, no sign-off.`

  return anthropic.messages.stream({
    model: CHECKIN_MODEL,
    max_tokens: 6000,
    system: CHECKIN_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: CHECKIN_EFFORT },
  })
}
