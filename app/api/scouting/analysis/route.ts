import { NextRequest, NextResponse } from 'next/server'
import { migrationHintFor } from '@/lib/migrationHints'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { COACH_VOICE } from '@/lib/coachVoice'
import {
  aggregateBattingLines, stalenessLabel, MIN_PA_FOR_TENDENCY, SCOUT_META_SENTINEL,
} from '@/lib/scouting'
import { guard } from '@/lib/authz'

// The standing read on an opponent.
//
// Scouting captured well and then handed the coach a pile: four box scores,
// two recaps, a note. Synthesis was left as an exercise. What a coach wants
// twenty minutes before first pitch is one page — how this team plays, who
// can pitch, what to do about it — and they want it to know about the game
// they logged last weekend.
//
// Two boundaries from the original scouting spec, enforced in the prompt
// because that is where they can actually be broken:
//   - no cross-account aggregation; this is one coach's own observations
//   - no player-level narrative about a child beyond observable baseball

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export const maxDuration = 300

const ANALYSIS_MODEL = 'claude-opus-5'

// ---------------------------------------------------------------------------
// GET — the current analysis, and whether it's behind the evidence
//   ?coachId=&opponentTeamId=
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const opponentTeamId = searchParams.get('opponentTeamId')

  if (!coachId || !opponentTeamId) {
    return NextResponse.json({ error: 'coachId and opponentTeamId required' }, { status: 400 })
  }

  try {
    const [{ data: analyses }, { data: team }] = await Promise.all([
      supabaseAdmin
        .from('opponent_analyses')
        .select('*')
        .eq('opponent_team_id', opponentTeamId)
        .eq('coach_id', coachId)
        .order('generated_at', { ascending: false })
        .limit(2),
      supabaseAdmin
        .from('opponent_teams')
        .select('id, name, analysis_stale')
        .eq('id', opponentTeamId)
        .maybeSingle(),
    ])

    return NextResponse.json({
      analysis: analyses?.[0] || null,
      previous: analyses?.[1] || null,
      stale: (team as any)?.analysis_stale ?? false,
    })
  } catch (error: any) {
    console.error('Scouting analysis GET error:', error)
    return NextResponse.json({ analysis: null, previous: null, stale: false, needsMigration: true, migrationMessage: migrationHintFor(error)?.message || null })
  }
}

// ---------------------------------------------------------------------------
// POST — write (or rewrite) the analysis. Streams.
//   { coachId, opponentTeamId }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  try {
    const { coachId, opponentTeamId } = await request.json()

    if (!coachId || !opponentTeamId) {
      return NextResponse.json({ error: 'coachId and opponentTeamId are required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const evidence = await gatherOpponentEvidence(coachId, opponentTeamId)
    if (!evidence) {
      return NextResponse.json({ error: 'Opponent not found' }, { status: 404 })
    }
    if (evidence.entryCount === 0 && evidence.playerCount === 0) {
      return NextResponse.json({
        error: 'Nothing logged for this team yet. Add a box score, recap or note first.',
      }, { status: 400 })
    }

    // The previous read, so the model can say what actually changed rather
    // than rewriting the same page with different words.
    const { data: prior } = await supabaseAdmin
      .from('opponent_analyses')
      .select('markdown, generated_at')
      .eq('opponent_team_id', opponentTeamId)
      .order('generated_at', { ascending: false })
      .limit(1)

    const previous = prior?.[0] || null

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let markdown = ''
        try {
          const gen = writeAnalysis(evidence, previous)
          for await (const event of gen) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const chunk = (event.delta as any).text as string
              markdown += chunk
              controller.enqueue(encoder.encode(chunk))
            }
          }

          const headline = extractHeadline(markdown)
          const whatsChanged = extractSection(markdown, "What's changed")

          // The insert error used to be discarded. A report that streamed
          // perfectly and then failed to save looked identical to one that
          // saved — until the coach came back and it was gone.
          const { data: saved, error: saveError } = await supabaseAdmin
            .from('opponent_analyses')
            .insert({
              coach_id: coachId,
              opponent_team_id: opponentTeamId,
              markdown,
              headline,
              whats_changed: whatsChanged,
              entry_count: evidence.entryCount,
              player_count: evidence.playerCount,
              latest_entry_on: evidence.latestEntryOn,
              total_pa: evidence.totalPa,
            })
            .select('id, generated_at')
            .single()

          await supabaseAdmin
            .from('opponent_teams')
            .update({ analysis_stale: false })
            .eq('id', opponentTeamId)

          if (saveError) console.error('Scouting analysis save failed:', saveError)

          controller.enqueue(encoder.encode(SCOUT_META_SENTINEL + JSON.stringify({
            id: (saved as any)?.id || null,
            generated_at: (saved as any)?.generated_at || null,
            headline,
            entry_count: evidence.entryCount,
            total_pa: evidence.totalPa,
            // Said out loud so the screen can warn that what they are reading
            // is not coming back next time.
            saveError: saveError
              ? (migrationHintFor(saveError)?.message || saveError.message || 'Could not save the report.')
              : null,
          })))
        } catch (e: any) {
          console.error('Scouting analysis stream error:', e)
          controller.enqueue(encoder.encode(SCOUT_META_SENTINEL + JSON.stringify({
            error: e?.message || 'The analysis stopped part-way through. Try again.',
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
    console.error('Scouting analysis POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

function extractSection(markdown: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'im')
  const m = markdown.match(re)
  return m ? m[1].trim() || null : null
}

function extractHeadline(markdown: string): string | null {
  const beats = extractSection(markdown, 'How to beat them') || extractSection(markdown, 'The read')
  if (!beats) return null
  const firstSentence = beats.split(/(?<=[.!?])\s/)[0]
  return firstSentence?.slice(0, 240) || null
}

// --- evidence ---------------------------------------------------------------

interface OpponentEvidence {
  team: any
  entryCount: number
  playerCount: number
  latestEntryOn: string | null
  totalPa: number
  rendered: string
}

async function gatherOpponentEvidence(
  coachId: string,
  opponentTeamId: string
): Promise<OpponentEvidence | null> {
  const { data: team } = await supabaseAdmin
    .from('opponent_teams')
    .select('*')
    .eq('id', opponentTeamId)
    .eq('coach_id', coachId)
    .maybeSingle()

  if (!team) return null
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: entries }, { data: players }] = await Promise.all([
    supabaseAdmin
      .from('scouting_entries')
      .select('id, entry_type, occurred_on, tournament_name, notes, raw_parse, parse_confidence')
      .eq('opponent_team_id', opponentTeamId)
      .order('occurred_on', { ascending: false })
      .limit(30),
    supabaseAdmin
      .from('opponent_players')
      .select('id, name, jersey_number, bats, throws, positions, notes, confidence, last_seen')
      .eq('opponent_team_id', opponentTeamId),
  ])

  const playerIds = (players || []).map((p: any) => p.id)
  const { data: appearances } = playerIds.length
    ? await supabaseAdmin
        .from('opponent_appearances')
        .select('opponent_player_id, game_date, batting_order_slot, positions_played, batting_line, pitches_thrown, innings_pitched')
        .in('opponent_player_id', playerIds)
        .order('game_date', { ascending: false })
    : { data: [] as any[] }

  const byPlayer: Record<string, any[]> = {}
  for (const a of (appearances || []) as any[]) {
    ;(byPlayer[a.opponent_player_id] ||= []).push(a)
  }

  const parts: string[] = []
  let totalPa = 0

  parts.push(
    `OPPONENT: ${team.name}` +
    `${team.org_name ? ` (${team.org_name})` : ''}` +
    `${team.age_group ? ` · ${team.age_group}` : ''}` +
    `${team.region ? ` · ${team.region}` : ''}\n` +
    `Logged from ${team.first_seen || 'unknown'} to ${team.last_seen || 'unknown'}` +
    `${team.last_seen ? ` — most recent look is ${stalenessLabel(team.last_seen, today)}` : ''}` +
    `${team.notes ? `\nYour notes on the team: ${team.notes}` : ''}`
  )

  // Roster with aggregated lines. Small samples are labelled here rather than
  // left for the model to notice.
  const playerBlocks: string[] = []
  for (const p of (players || []) as any[]) {
    const apps = byPlayer[p.id] || []
    const lines = apps.map((a: any) => a.batting_line).filter(Boolean)
    const totals = aggregateBattingLines(lines)
    // pa already accounts for HBP; recomputing it here would undercount.
    const pa = totals.pa
    totalPa += pa

    const pitching = apps.filter((a: any) => a.pitches_thrown != null || a.innings_pitched != null)
    const positions = Array.from(new Set([
      ...(p.positions || []),
      ...apps.flatMap((a: any) => a.positions_played || []),
    ]))

    playerBlocks.push(
      `  ${p.name}${p.jersey_number ? ` (#${p.jersey_number})` : ''}` +
      `${positions.length ? ` — ${positions.join('/')}` : ''}` +
      `${p.bats ? `, bats ${p.bats}` : ''}${p.throws ? `, throws ${p.throws}` : ''}` +
      `${p.confidence !== 'confirmed' ? ` [identity ${p.confidence} — may be a duplicate row]` : ''}\n` +
      (pa > 0
        ? `      ${apps.length} games: ${totals.h}-for-${totals.ab}` +
          `, ${totals.bb}BB ${totals.k}K, ${totals.xbh} XBH, ${totals.sb}SB` +
          (pa < MIN_PA_FOR_TENDENCY ? `  ⚠ only ~${pa} PA — an observation, NOT a tendency` : '')
        : '      no batting lines logged') +
      (pitching.length
        ? `\n      pitched ${pitching.length} time(s): ` +
          pitching.map((a: any) =>
            `${a.game_date} — ${a.pitches_thrown ?? '?'} pitches` +
            `${a.innings_pitched ? `, ${a.innings_pitched} IP` : ''}`
          ).join('; ')
        : '') +
      (p.notes ? `\n      your note: ${p.notes}` : '')
    )
  }

  if (playerBlocks.length > 0) {
    parts.push(`THEIR PLAYERS (${playerBlocks.length}):\n${playerBlocks.join('\n')}`)
  }

  // Recaps and notes — the qualitative half, and usually the better half
  const narrative = (entries || []).filter((e: any) => e.notes || e.raw_parse)
  if (narrative.length > 0) {
    parts.push(
      `WHAT YOU LOGGED (most recent first):\n` +
      narrative.slice(0, 15).map((e: any) => {
        const rp = e.raw_parse || {}
        const bits: string[] = []
        if (rp.summary) bits.push(`summary: ${rp.summary}`)
        if (rp.pitching_notes) bits.push(`pitching: ${rp.pitching_notes}`)
        if (Array.isArray(rp.tendencies) && rp.tendencies.length) {
          bits.push(`tendencies noted: ${rp.tendencies.join(', ')}`)
        }
        if (e.notes) bits.push(`your note: ${e.notes}`)
        return `  ${e.occurred_on || 'undated'} [${e.entry_type}]` +
          `${e.tournament_name ? ` (${e.tournament_name})` : ''}` +
          `${e.parse_confidence === 'low' ? ' — parse confidence LOW, treat carefully' : ''}` +
          (bits.length ? `\n      ${bits.join('\n      ')}` : '')
      }).join('\n')
    )
  }

  const latestEntryOn = (entries || [])[0]?.occurred_on || null

  return {
    team,
    entryCount: (entries || []).length,
    playerCount: (players || []).length,
    latestEntryOn,
    totalPa,
    rendered: parts.join('\n\n'),
  }
}

// --- the write --------------------------------------------------------------

const SCOUT_SYSTEM = `${COACH_VOICE}

WHAT THIS SURFACE IS

You are writing the scouting report a coach reads twenty minutes before first pitch, standing up, on bad wifi. It has to be skimmable and it has to be about what to DO.

TWO HARD BOUNDARIES

1. Everything below is one coach's own observations of games they were at. It is not a league database and there is no other account's data in it. Never imply broader knowledge of this team than what is in front of you, and never reference a source you were not given.

2. These are children. Write about performance and availability only — what a player did on a field, and what the pitch counts mean for who can throw. Never characterize a child's attitude, character, effort, or body. "Their #7 has thrown 68 pitches in two days" is the job. "Their #7 looks lazy" is not, and neither is anything about how a kid is built.

SAMPLE SIZE IS THE WHOLE GAME HERE

Youth scouting data is thin and you will be tempted to build a story out of eleven plate appearances. Don't. Say "we've only seen him twice" and mean it. A confident wrong read costs a coach a game; an honest "we don't know yet, here's what to watch in the first inning" is worth more and is what a good scout actually says.

Recency outranks volume. A team that has turned over its roster since April is a different team.`

function writeAnalysis(ev: OpponentEvidence, previous: { markdown: string; generated_at: string } | null) {
  const thin = ev.totalPa < MIN_PA_FOR_TENDENCY * 2

  const prompt = `Write the standing scouting report on this opponent, from everything the coach has logged.

${ev.rendered}

${previous ? `YOUR PREVIOUS REPORT ON THIS TEAM (written ${String(previous.generated_at).slice(0, 10)}):
"""
${previous.markdown.slice(0, 6000)}
"""

New evidence has come in since. Rewrite the report fully — do not patch it — but you now also owe the coach a "What's changed" section that says what is genuinely different from the read above. If nothing material changed, say exactly that in one sentence rather than manufacturing a difference.
` : ''}
---

Use these H2 headings, in this order.${previous ? '' : ' Omit "What\'s changed" — this is the first report.'}

## How they play
Two or three paragraphs. The shape of this team: do they put the ball in play or strike out, do they run, is the damage concentrated in two hitters or spread through the order. Be explicit about what you are confident in and what you are guessing from a handful of at-bats.${thin ? ' You have very little data here, so most of this section should be honest about that — say what you would need to see to know more.' : ''}

## Their pitching
Who has pitched, how much, and what that means for availability if you see them again this weekend. Pitch counts and rest are the concrete, checkable part of this report and the part a coach cannot work out in their head — lead with the numbers you actually have. If nobody's pitch counts were logged, say so plainly and tell them what to record next time.

## Watch for
Three to five specific, observable things, as bullets. Each one has to be something the coach can actually see from the dugout in the first inning — "their #4 chases the high fastball", "they send the runner on almost every 3-1 count" — not "they're a good hitting team".

## How to beat them
Lead with the single highest-leverage thing. Then the supporting moves: how to set your defense, what your pitcher should be trying to do, when to run. Concrete enough to give to an assistant coach who hasn't read the rest of this.
${previous ? `
## What's changed
What is genuinely different since the last report, and what it means. One short paragraph. "Nothing material — the extra game confirmed what we already had" is a complete and useful answer.
` : ''}
Write it now. No preamble, no sign-off.`

  return anthropic.messages.stream({
    model: ANALYSIS_MODEL,
    max_tokens: 6000,
    system: SCOUT_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'medium' },
  })
}
