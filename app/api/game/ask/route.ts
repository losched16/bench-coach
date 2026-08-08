import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { COACH_VOICE } from '@/lib/coachVoice'
import { requireText } from '@/lib/claudeText'
import {
  SubRuleSet, DEFAULT_SUB_RULES, PlayerGameState, renderSubstitutionState,
} from '@/lib/substitutions'

// Same shape as the check-in verdict: prose the coach reads, then a machine
// tail. One call rather than a second model pass to classify what they said.
const RULE_SENTINEL = '\n<<<BENCHCOACH_RULE>>>'

// The dugout assistant.
//
// "Can I bring RJ back in?" is a question with a right answer, and the coach
// is asking it between innings with a parent waiting. So this reasons from
// lib/substitutions — the exact module the swap buttons enforce — rather than
// from the model's memory of a rulebook. If the two ever disagreed, the coach
// would be right to stop trusting both.
//
// Deliberately not the general CoachAI: that one is about development over
// weeks. This is about the next half-inning, and it answers in a sentence.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// A coach standing on a field will not wait 40 seconds for an answer.
export const maxDuration = 60
const MODEL = 'claude-sonnet-5'

const SYSTEM = `${COACH_VOICE}

WHERE YOU ARE

It is the middle of a game. The coach is holding a phone between innings, with
players waiting. Answer in two or three sentences. No preamble, no structure,
no bullet lists unless they genuinely asked for options.

WHAT YOU KNOW

The substitution state below is authoritative and comes from the same rules
engine the app enforces. Never contradict it and never soften it — if a move
is listed as illegal, the answer is no, and you say which rule stops it.

Pitch counts, innings played and who is available are also below. Use them.

HARD RULES

1. Rules questions get a definite answer. "Can I bring RJ back?" is yes or no
   followed by why, not "it depends on your league" when the ruleset is stated
   right there.

2. Anything the ruleset does NOT cover — courtesy runners, pitching re-entry
   restrictions, injury exceptions, mercy rules — say plainly that it depends
   on their league and to check the rulebook. Do not guess. A confident wrong
   answer here costs a protest.

3. Judgement questions ("should I put him in now or later?") get an opinion
   with a reason, not a list of considerations. They asked because they want
   someone to decide with them. If the numbers below make it obvious, say so
   and say which number.

4. Pitch counts are a safety matter. If a pitcher is near or past a limit and
   the question touches them, say it whether or not they asked.

5. Never suggest a move the state says is illegal, even as an option.

HOUSE RULES

The coach may state a rule their league uses that the app does not model. Treat
anything under HOUSE RULES below as true, and answer with it.

When a house rule CONTRADICTS the ruleset the app is enforcing, say so in one
sentence: the app will still flag that move, and they can use the override or
change the ruleset setting. Never imply a button will allow something it will
refuse — a coach who is told "yes" and then blocked stops trusting both.

AFTER YOUR ANSWER

If the coach's message states a durable rule — something that should hold for
the rest of this game rather than a one-off question — end your reply with the
line ${RULE_SENTINEL.trim()} followed by JSON:

{"houseRule": "<the rule, in one plain sentence, or null>",
 "proposedRuleSet": "starter_reentry" | "continuous_free" | "no_reentry" | null}

Set proposedRuleSet ONLY when what they described plainly IS one of those three
— "everybody bats and we sub freely" is continuous_free. If it is a quirk on
top of a ruleset, leave it null and put it in houseRule. If they asked a
question rather than stating a rule, omit the line entirely.`

export async function POST(request: NextRequest) {
  try {
    const { gameId, question } = await request.json()
    if (!gameId || !question?.trim()) {
      return NextResponse.json({ error: 'gameId and a question are required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const [{ data: game }, { data: rows }, { data: pitches }, { data: notes }] = await Promise.all([
      supabaseAdmin
        .from('games')
        .select('id, opponent, current_inning, total_innings, team_score, opponent_score, sub_rules, team_id, house_rules')
        .eq('id', gameId)
        .maybeSingle(),
      supabaseAdmin
        .from('game_participation')
        .select('*, team_player:team_players(id, player:players(name))')
        .eq('game_id', gameId),
      supabaseAdmin
        .from('game_pitch_counts')
        .select('player_id, inning, pitch_count, player:players(name)')
        .eq('game_id', gameId),
      supabaseAdmin
        .from('game_notes')
        .select('note, note_type, inning, player:players(name)')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })
        .limit(15),
    ])

    if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    const g = game as any
    const rules: SubRuleSet = g.sub_rules || DEFAULT_SUB_RULES

    const players: PlayerGameState[] = (rows || []).map((r: any) => ({
      teamPlayerId: r.team_player_id,
      name: r.team_player?.player?.name || 'Unknown',
      isStarter: !!r.is_starter,
      battingSlot: r.batting_slot ?? null,
      isIn: !!r.is_in,
      timesRemoved: r.times_removed || 0,
      reentries: r.reentries || 0,
    }))

    // Pitch counts, by pitcher, with the inning split — the shape a coach
    // reads to decide whether an arm has another inning in it.
    const byPitcher: Record<string, { name: string; total: number; innings: number[] }> = {}
    for (const p of (pitches || []) as any[]) {
      const e = (byPitcher[p.player_id] ||= { name: p.player?.name || 'Unknown', total: 0, innings: [] })
      e.total += p.pitch_count || 0
      if (p.pitch_count > 0) e.innings.push(p.inning)
    }
    const pitchBlock = Object.values(byPitcher).length
      ? Object.values(byPitcher)
          .map(p => `    ${p.name}: ${p.total} pitches (innings ${p.innings.sort((a, b) => a - b).join(', ')})`)
          .join('\n')
      : '    (nobody has thrown yet)'

    const noteBlock = (notes || []).length
      ? (notes as any[])
          .map(n => `    Inn ${n.inning || '?'}${n.player?.name ? ` — ${n.player.name}` : ''}: ${n.note}`)
          .join('\n')
      : '    (no notes taken this game)'

    const context = [
      `THE GAME: vs ${g.opponent || 'unknown opponent'}, inning ${g.current_inning || 1} of ${g.total_innings || 6}` +
        (g.team_score != null && g.opponent_score != null ? `, ${g.team_score}-${g.opponent_score}` : ''),
      '',
      renderSubstitutionState(players, rules),
      '',
      g.house_rules
        ? `HOUSE RULES the coach has told us about this game:\n${
            String(g.house_rules).split('\n').map((l: string) => `    ${l}`).join('\n')
          }`
        : 'HOUSE RULES: none stated.',
      '',
      'PITCH COUNTS THIS GAME:',
      pitchBlock,
      '',
      'NOTES TAKEN THIS GAME:',
      noteBlock,
    ].join('\n')

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: 'user', content: `${context}\n\nTHE COACH ASKS: ${question.trim()}` }],
      // Between innings. The rules state is already resolved above — this is a
      // lookup and a judgement call, not a reasoning problem.
      output_config: { effort: 'low' },
    })

    const raw = requireText(response, 'dugout answer')

    // Split the prose from the tail. The coach never sees the JSON.
    const at = raw.indexOf(RULE_SENTINEL.trim())
    const answer = (at === -1 ? raw : raw.slice(0, at)).trim()

    let houseRuleAdded: string | null = null
    let proposedRuleSet: SubRuleSet | null = null

    if (at !== -1) {
      try {
        const m = raw.slice(at).match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0]) as { houseRule?: string | null; proposedRuleSet?: string | null }

          if (parsed.houseRule?.trim()) {
            // Appended, not replaced: a coach states rules one at a time as
            // they come up, and losing the first one when they mention the
            // second is exactly the failure this feature exists to prevent.
            const existing = (g.house_rules || '').trim()
            const line = parsed.houseRule.trim()
            const alreadyThere = existing
              .split('\n')
              .some((l: string) => l.trim().toLowerCase() === line.toLowerCase())
            if (!alreadyThere) {
              houseRuleAdded = line
              await supabaseAdmin
                .from('games')
                .update({ house_rules: existing ? `${existing}\n${line}` : line })
                .eq('id', gameId)
            }
          }

          // Proposed, never applied here. Changing which rules a game is
          // played under from a chat message, without confirmation, is how a
          // coach ends up in the wrong ruleset in the fourth inning.
          if (
            parsed.proposedRuleSet === 'starter_reentry' ||
            parsed.proposedRuleSet === 'continuous_free' ||
            parsed.proposedRuleSet === 'no_reentry'
          ) {
            if (parsed.proposedRuleSet !== rules) proposedRuleSet = parsed.proposedRuleSet
          }
        }
      } catch {
        // A malformed tail costs the rule capture, not the answer.
      }
    }

    return NextResponse.json({ answer, houseRuleAdded, proposedRuleSet })
  } catch (error: any) {
    console.error('Game ask error:', error)
    return NextResponse.json({ error: error.message || 'Could not answer that' }, { status: 500 })
  }
}
