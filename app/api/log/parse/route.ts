import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { textFrom } from '@/lib/claudeText'
import { matchRosterPlayer, RosterCandidate } from '@/lib/entries'
import { guard } from '@/lib/authz'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Parses the coach's OWN box scores. Two things make this different from the
// scouting parser: a tournament weekend is several games in one submission,
// and parsed names get matched against the real roster.
//
// This never dead-ends. If the images can't be read, the caller still saves
// the entry with its notes — observations alone are sufficient input to the
// diagnosis engine.

function buildPrompt(teamName: string | null, imageCount: number): string {
  return `Analyze ${imageCount === 1 ? 'this screenshot' : `these ${imageCount} screenshots`} of youth baseball box scores (likely from GameChanger).

${teamName ? `The coach's team is "${teamName}". Extract ONLY that team's players — ignore the opponent's side of the box score.` : 'Extract the players from the team the screenshots are centered on.'}

${imageCount > 1 ? 'These may be SEPARATE GAMES from a tournament weekend, or multiple views of the same game. Group them correctly: one entry in "games" per distinct game. If two images show the same game (e.g. batting and pitching views), merge them into one game entry.' : ''}

Return ONLY valid JSON in this exact shape, no other text:
{
  "games": [
    {
      "game_date": "YYYY-MM-DD if visible, else null",
      "opponent": "opponent team name, or null",
      "team_score": 7,
      "opponent_score": 4,
      "result": "W | L | T | null",
      "players": [
        {
          "name": "player name exactly as printed (do not expand abbreviations)",
          "jersey_number": "12 or null",
          "batting_line": {"ab": 3, "h": 2, "2b": 0, "3b": 0, "hr": 0, "rbi": 1, "r": 1, "bb": 1, "k": 0, "sb": 0},
          "innings_pitched": 2.1,
          "pitches_thrown": 45,
          "pitching_k": 3,
          "pitching_bb": 1,
          "errors": 0,
          "low_confidence_fields": ["k"]
        }
      ],
      "confidence": "high|medium|low",
      "warnings": ["anything cut off, blurry, or ambiguous"]
    }
  ]
}

Rules that matter:
- NEVER invent a number you cannot actually see. Omit the field instead. A missing stat is fine; a wrong stat is not.
- "low_confidence_fields" lists any field in that player's line you had to squint at or infer. The coach reviews these before saving, so flagging honestly is more useful than appearing certain.
- Pitching fields (innings_pitched, pitches_thrown, pitching_k, pitching_bb) are null for players who did not pitch.
- Keep names exactly as printed — "C. Smith" stays "C. Smith". Do not guess the full first name.
- "confidence" is per game: "high" only when the names and numbers were all clearly legible.
- If the images are not box scores at all, return {"games": [], "warnings": ["not a box score"]}.`
}

// Vision and generation calls take real time now that thinking is on by
// default. Without this the platform kills the function at its 15s default
// and the user sees a failure that has nothing to do with their input.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  try {
    const { images, teamId, teamName } = await request.json()

    const imageList = Array.isArray(images) ? images : []
    if (imageList.length === 0) {
      return NextResponse.json({ error: 'No screenshots provided' }, { status: 400 })
    }

    // Roster + previously confirmed name mappings, so matching improves over time
    let roster: RosterCandidate[] = []
    let savedMappings: Record<string, string> = {}
    if (teamId) {
      const [rosterRes, mappingRes] = await Promise.all([
        supabaseAdmin
          .from('team_players')
          .select('id, player:players(name, jersey_number)')
          .eq('team_id', teamId),
        supabaseAdmin
          .from('roster_name_mappings')
          .select('source_name, team_player_id')
          .eq('team_id', teamId),
      ])

      roster = (rosterRes.data || []).map((tp: any) => ({
        team_player_id: tp.id,
        name: tp.player?.name || '',
        jersey_number: tp.player?.jersey_number ?? null,
      })).filter((r: RosterCandidate) => r.name)

      for (const m of mappingRes.data || []) {
        savedMappings[String(m.source_name).trim().toLowerCase()] = m.team_player_id
      }
    }

    const content: any[] = imageList.slice(0, 8).map((img: any) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType || 'image/png',
        data: img.data,
      },
    }))
    content.push({ type: 'text', text: buildPrompt(teamName || null, content.length) })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      // Thinking spends from this budget too, and a truncated box score is
      // unparseable JSON rather than a partial result.
      max_tokens: 16000,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low' },
    })

    const raw = textFrom(response)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      // Soft failure — the caller still saves the entry with notes.
      return NextResponse.json({
        games: [],
        parseFailed: true,
        message: "Couldn't read those screenshots. Your notes will still save — you can add the stats later.",
      })
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({
        games: [],
        parseFailed: true,
        message: "Couldn't read those screenshots. Your notes will still save — you can add the stats later.",
      })
    }

    // Attach roster matches so the review table opens pre-filled.
    // Home scope (a single-player roster) needs no matching UI at all.
    const skipMatching = roster.length <= 1
    const games = (parsed.games || []).map((game: any) => ({
      ...game,
      players: (game.players || [])
        .filter((p: any) => p?.name && typeof p.name === 'string')
        .map((p: any) => {
          const match = skipMatching
            ? { team_player_id: roster[0]?.team_player_id || null, confidence: 'exact' as const }
            : matchRosterPlayer(p.name, p.jersey_number, roster, savedMappings)
          return {
            ...p,
            name: p.name.trim(),
            jersey_number: p.jersey_number != null ? String(p.jersey_number).trim() : null,
            low_confidence_fields: Array.isArray(p.low_confidence_fields) ? p.low_confidence_fields : [],
            team_player_id: match.team_player_id,
            match_confidence: match.confidence,
          }
        }),
    }))

    return NextResponse.json({
      games,
      roster,
      skipMatching,
      unmatchedCount: games.reduce(
        (n: number, g: any) => n + g.players.filter((p: any) => !p.team_player_id).length,
        0
      ),
    })
  } catch (error: any) {
    console.error('Log parse error:', error)
    // Still soft — never block the save path on a parse problem.
    return NextResponse.json({
      games: [],
      parseFailed: true,
      message: error.message || "Couldn't read those screenshots. Your notes will still save.",
    })
  }
}
