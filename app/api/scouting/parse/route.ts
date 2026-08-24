import { NextRequest, NextResponse } from 'next/server'
import { textFrom } from '@/lib/claudeText'
import { requireSession } from '@/lib/authz'
import { createClient } from '@supabase/supabase-js'
import { chooseTrackedSide, ownPlayersIn, ParsedSide } from '@/lib/scoutingSides'
import { todayISO, checkGameDate } from '@/lib/gameDate'
import { claude as anthropic, describeClaudeFailure, logClaudeFailure } from '@/lib/claudeClient'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Parses scouting screenshots (GameChanger box scores, recaps, tournament
// brackets) with Claude vision. Returns structured data for the coach to
// review BEFORE anything is saved — the capture screen is the confirm step.

// Both teams, separated — NOT "the opponent".
//
// This used to say "Extract the OPPONENT team's data" and send nothing but the
// image. A box score shows both teams, and the model was never told our team
// name, the opponent's name, or our roster, so "the opponent" was unanswerable
// and it either guessed or returned everybody. A coach's own players ended up
// in an opponent's roster, where they drive pitch-count availability.
//
// Reading two teams off a screenshot is what vision is good at. Deciding which
// one is the opponent is the app's job, because the app is the only thing that
// knows. lib/scoutingSides.ts does that afterwards.
const BOX_SCORE_PROMPT = `Analyze this screenshot of a youth baseball box score (likely from GameChanger).

A box score shows TWO teams. Extract BOTH of them, separately and completely. Do NOT decide which team matters and do not merge them — a player belongs to exactly one team, and putting a player under the wrong team is the worst mistake you can make here.

Return ONLY valid JSON in this exact shape, no other text:
{
  "game_date": "YYYY-MM-DD, or null. See the date rule below — do NOT guess a year.",
  "final_score": "e.g. 7-4, or null",
  "teams": [
    {
      "team_name": "team name exactly as shown, or null if not visible",
      "side": "home | away | null — only if the image actually says which",
      "players": [
        {
          "name": "player name as printed (do not guess expansions of abbreviated names)",
          "jersey_number": "12 or null",
          "batting_order_slot": 1,
          "positions": ["P", "SS"],
          "batting_line": {"ab": 3, "h": 2, "2b": 0, "3b": 0, "hr": 0, "rbi": 1, "bb": 1, "k": 0, "sb": 0},
          "pitches_thrown": 45,
          "innings_pitched": 2.1,
          "pitching_line": {"ip": 2.1, "h": 3, "r": 2, "er": 1, "bb": 4, "k": 5, "hr": 0, "hbp": 1, "bf": 14, "strikes": 28}
        }
      ]
    }
  ],
  "confidence": "high|medium|low",
  "warnings": ["anything cut off, blurry, or ambiguous"]
}

Rules:
- ALWAYS return the "teams" array. If only one team is visible in the image, return an array with one entry and say so in warnings — do not invent the second team or split one team into two.
- Never put the same player in both teams. If you genuinely cannot tell which team a player belongs to, leave them out and add a warning naming them.
- Team names: many youth box scores abbreviate or show only a logo. Return null rather than guessing a team name from the players.
- pitches_thrown and innings_pitched: null for players who did not pitch. Pitch counts matter most — read them carefully and never guess a number you cannot see.
- WHERE PITCH COUNTS LIVE. They are usually NOT in the pitching table. GameChanger prints them in a notes block under the box score, on a line labelled "Pitches-Strikes", as a hyphenated pair per pitcher: "Pitches-Strikes: Gio C 53-40, Austin B 37-21, Nash F 34-18". The FIRST number is total pitches thrown and the SECOND is how many of those were strikes. For Gio C that is pitches_thrown 53 and strikes 40. Read that line before deciding a pitcher has no pitch count — it is the single most important number on the page and it is easy to miss because it is not in the table.
- The same notes block carries other per-pitcher lines worth taking: "Batters Faced: Gio C 20, Austin B 12, Nash F 9" fills "bf", and "HBP: Austin B 3" fills "hbp" for that pitcher. Lines like "WP" (wild pitches) can be ignored.
- pitching_line: null for anyone who did not pitch. This is the PITCHING table of the box score, which is separate from the batting table and usually further down the page — find it before deciding a pitcher has no line. Its "bb" and "k" are walks ISSUED and strikeouts THROWN, which are completely different numbers from the "bb" and "k" in that same player's batting_line. Never copy one into the other.
- The pitching table is usually headed: IP, H, R, ER, BB, SO. Map them exactly — IP->ip, H->h, R->r, ER->er, BB->bb, SO->k. A column headed SO or K is strikeouts thrown; put it in "k".
- IP is printed in thirds, not decimals: "1.1" is one and one third innings and "1.2" is one and two thirds. Copy the printed value exactly. Never convert it, never round it, and never write "1.33".
- IGNORE ANY TOTALS ROW. Box scores end each table with a row labelled TEAM, TOTALS or similar, holding the sum for the whole side. That is not a player. Never emit it as one, and never let its numbers into any player's line.
- Omit batting_line and pitching_line fields you cannot see rather than inventing zeros; use null for unknown jersey numbers.
- Keep names exactly as printed (e.g. "T. Smith" stays "T. Smith").
- confidence reflects how readable the image was: "high" only if names, numbers, and pitch counts were all clearly legible.
- If the image is not a box score, return {"teams": [], "confidence": "low", "warnings": ["not a box score"]}.

THE DATE RULE — read this twice, it is the field most often wrong:
- Box scores routinely print "Jul 14" or "7/14" with NO YEAR. You do not know the year from that, and you must not invent one.
- If a full year is printed in the image, use it.
- If the day and month are printed but the year is NOT, use the most recent year in which that date has already happened, relative to today's date given below. A game shown as "Jul 14" when today is 11 Aug 2026 is 2026-07-14, never 2024-07-14.
- If you cannot see a date at all, return null. Null is always better than a guess — the coach types the date themselves and their answer wins over yours.
- Never return a date in the future.`

const RECAP_PROMPT = `Analyze this youth baseball game recap or summary (a screenshot and/or pasted text, likely from GameChanger). Extract scouting-relevant facts about the team described.

Return ONLY valid JSON, no other text:
{
  "team_name": "team name if identifiable, or null",
  "game_date": "YYYY-MM-DD if visible, else null",
  "summary": "2-3 sentence factual summary of what the recap says",
  "pitching_notes": "who pitched, how long, how effective — or null",
  "tendencies": ["observable team tendencies mentioned: aggressive baserunning, bunting, etc."],
  "players_mentioned": [
    {"name": "as printed", "jersey_number": "or null", "note": "observable baseball fact only"}
  ],
  "confidence": "high|medium|low",
  "warnings": []
}

Rules:
- Stick to observable baseball facts. Do not characterize individual kids beyond on-field performance.
- Keep names exactly as printed.
- If the image is not a game recap, return {"summary": null, "confidence": "low", "warnings": ["not a recap"]}.`

const BRACKET_PROMPT = `Analyze this screenshot of a youth baseball tournament bracket. Extract the structure so a coach can prep for teams they MIGHT face.

Return ONLY valid JSON, no other text:
{
  "tournament_name": "if visible, else null",
  "teams": [
    {"name": "team name as printed", "bracket_position": "e.g. 'Pool A seed 2' or 'upper bracket QF1'"}
  ],
  "games": [
    {"team_a": "name", "team_b": "name or 'TBD'", "round": "e.g. quarterfinal", "scheduled_at": "YYYY-MM-DD HH:MM if shown, else null"}
  ],
  "confidence": "high|medium|low",
  "warnings": []
}

Rules:
- Include every team name you can read, even in later TBD rounds.
- If the image is not a bracket, return {"teams": [], "games": [], "confidence": "low", "warnings": ["not a bracket"]}.`

// Read server-side rather than trusting a roster posted from the browser:
// the roster is a scoping decision, and this route already knows the session.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * The coach's own player names, for telling their team apart from the one they
 * are scouting. Returns [] on any failure — a missing roster should cost the
 * parser its best signal, not the whole upload.
 */
async function ourRosterNames(teamId: unknown): Promise<string[]> {
  if (!teamId || typeof teamId !== 'string') return []
  try {
    const { data, error } = await supabaseAdmin
      .from('team_players')
      .select('players(name)')
      .eq('team_id', teamId)
    if (error) throw error
    return (data as any[] || [])
      .map(r => r?.players?.name)
      .filter((n: any): n is string => typeof n === 'string' && n.trim().length > 0)
  } catch (e: any) {
    console.warn('Scouting parse: roster unavailable for side detection:', e?.message)
    return []
  }
}

const PROMPTS: Record<string, string> = {
  box_score: BOX_SCORE_PROMPT,
  recap: RECAP_PROMPT,
  bracket: BRACKET_PROMPT,
}

// Vision and generation calls take real time now that thinking is on by
// default. Without this the platform kills the function at its 15s default
// and the user sees a failure that has nothing to do with their input.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const {
      images, text, entryType,
      // The three things the app knows and the model cannot see. Without these
      // "which team is the opponent" is unanswerable from the pixels, which is
      // exactly how a coach's own players ended up in an opponent's roster.
      teamId, ourTeamName,
      // The team the coach selected — the SUBJECT of this upload, not our
      // adversary. Most scouting uploads are games we were not playing in.
      trackedTeamName,
      // The coach is logging their own game. Inverts the "is that us?" guards.
      trackedIsOwnTeam,
    } = await request.json()

    const imageList = Array.isArray(images) ? images : []
    const pastedText = typeof text === 'string' ? text.trim() : ''

    if (imageList.length === 0 && !pastedText) {
      return NextResponse.json({ error: 'Provide screenshots and/or pasted text' }, { status: 400 })
    }

    const prompt = PROMPTS[entryType]
    if (!prompt) {
      return NextResponse.json({ error: `Unsupported entry type for parsing: ${entryType}` }, { status: 400 })
    }

    const content: any[] = imageList.slice(0, 5).map((img: any) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType || 'image/png',
        data: img.data,
      },
    }))

    let promptText = prompt
    // The model has no clock. Without today's date, resolving a box score that
    // prints "Jul 14" with no year is guesswork, and the guess lands near its
    // training data — which is how a July 2026 game was logged as 2024.
    promptText += `\n\nTODAY'S DATE IS ${todayISO()}. Use it to resolve any date printed without a year, and never return a date after it.`
    // Naming the tracked team helps the model READ an abbreviated scoreboard
    // ("WAR" over a logo) — it does not ask the model to choose a side. That
    // decision stays in lib/scoutingSides.ts, where it can be tested and where
    // it refuses to guess.
    if (entryType === 'box_score' && typeof trackedTeamName === 'string' && trackedTeamName.trim()) {
      promptText += `\n\nThe coach is logging a team they call "${trackedTeamName.trim()}". If one of the teams in this image is abbreviated or shown as a logo and you can tell it is that team, use the full name "${trackedTeamName.trim()}" as its team_name. Still return BOTH teams — do not drop the other one, and do not move players between them to make it fit.`
    }
    if (imageList.length > 1) {
      promptText += `\n\nThere are ${imageList.length} images of the SAME game/document — combine them into one result.`
    }
    if (pastedText) {
      promptText += imageList.length > 0
        ? `\n\nA written recap of the SAME game is pasted below — combine it with the image(s) into one result. Use it to fill gaps the image doesn't show (who pitched, how the game went, tendencies).`
        : `\n\nThe recap text is pasted below (no image).`
      promptText += `\n\nPASTED RECAP TEXT:\n"""\n${pastedText.slice(0, 12000)}\n"""`
    }
    content.push({ type: 'text', text: promptText })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      // Box scores are long JSON and thinking spends from this budget — too
      // low and the object truncates mid-array and never parses.
      max_tokens: 16000,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low' },
    })

    const responseText = textFrom(response)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'Could not parse the recap. Try a clearer image or more complete text.', raw: responseText },
        { status: 400 }
      )
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e) {
      return NextResponse.json(
        { error: 'Could not parse the recap. Try a clearer image or more complete text.', raw: responseText },
        { status: 400 }
      )
    }

    // Every value in a stat line has to be a number or absent. A model that
    // writes "-" or "" for a column it could not read would otherwise put a
    // string into JSONB, where it survives all the way to an arithmetic
    // operation somewhere much less convenient.
    const cleanNumericLine = (line: any): Record<string, number> | null => {
      if (!line || typeof line !== 'object') return null
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(line)) {
        const n = Number(v)
        if (v !== null && v !== '' && !isNaN(n)) out[k] = n
      }
      return Object.keys(out).length > 0 ? out : null
    }

    // Every box-score table ends with a TEAM/TOTALS row holding the sum for the
    // whole side. Read as a player it becomes a phantom with the batting line
    // of nine kids — and on the pitching table, a "player" who threw every
    // pitch of the game, which would wreck the availability board. The prompt
    // says to skip it; this is the control, because a prompt rule is not one.
    const TOTALS_ROW = /^\s*(team|totals?|team totals?)\s*$/i

    // Light cleanup so downstream math is safe.
    const cleanPlayers = (players: any[]) =>
      (players || [])
        .filter((p: any) => p?.name && typeof p.name === 'string')
        .filter((p: any) => !TOTALS_ROW.test(p.name))
        .map((p: any) => ({
          ...p,
          name: p.name.trim(),
          jersey_number: p.jersey_number != null ? String(p.jersey_number).trim() : null,
          pitches_thrown:
            p.pitches_thrown != null && !isNaN(Number(p.pitches_thrown))
              ? Number(p.pitches_thrown)
              : null,
          innings_pitched:
            p.innings_pitched != null && !isNaN(Number(p.innings_pitched))
              ? Number(p.innings_pitched)
              : null,
          pitching_line: cleanNumericLine(p.pitching_line),
        }))

    // A date we cannot believe is worse than no date: it silently ages the
    // record and every staleness check downstream then discounts good scouting
    // as historical. Strip it and say why, rather than passing it on.
    const dateCheck = checkGameDate(parsed.game_date)
    if (parsed.game_date && !dateCheck.date) {
      parsed.game_date = null
      if (dateCheck.note) {
        parsed.warnings = [...(Array.isArray(parsed.warnings) ? parsed.warnings : []), dateCheck.note]
      }
    } else if (dateCheck.date) {
      parsed.game_date = dateCheck.date
    }

    if (entryType === 'box_score') {
      // The model now returns both teams. Older responses (and any model that
      // ignores the instruction) come back with a flat players array — treat
      // that as a single unlabelled side rather than failing.
      const rawSides: ParsedSide[] = Array.isArray(parsed.teams)
        ? parsed.teams.map((t: any) => ({
            team_name: t?.team_name || null,
            side: t?.side || null,
            players: cleanPlayers(t?.players),
          }))
        : Array.isArray(parsed.players)
          ? [{ team_name: parsed.team_name || null, side: null, players: cleanPlayers(parsed.players) }]
          : []

      const sides = rawSides.filter(s => s.players.length > 0)
      const roster = await ourRosterNames(teamId)
      const choice = chooseTrackedSide(sides, {
        trackedTeamName: typeof trackedTeamName === 'string' ? trackedTeamName : null,
        trackedIsOwnTeam: !!trackedIsOwnTeam,
        ourTeamName: typeof ourTeamName === 'string' ? ourTeamName : null,
        ourRoster: roster,
      })

      // Belt to the braces. Even with the right side chosen, one stray row is
      // enough to put a coach's own kid into an opponent's pitch-count board —
      // so name the ones that look like ours and let the coach decide. The
      // roster itself stays server-side; only the matched names go back.
      const ownPlayers = ownPlayersIn(choice.tracked?.players || [], roster)

      return NextResponse.json({
        // The old shape, so every downstream reader is unchanged — it now holds
        // one team rather than a guess spanning both.
        parsed: {
          ...parsed,
          team_name: choice.tracked?.team_name || parsed.team_name || null,
          players: choice.tracked?.players || [],
        },
        // Everything needed to show the coach what was decided and let them
        // change it in one tap. A silent pick is what caused the problem.
        sides: sides.map(s => ({
          team_name: s.team_name,
          side: s.side,
          player_count: s.players.length,
          sample: s.players.slice(0, 4).map((p: any) => p.name),
          players: s.players,
          is_ours: s === choice.ours,
        })),
        sideChoice: { reason: choice.reason, confident: choice.confident, ownPlayers },
      })
    }

    return NextResponse.json({ parsed })
  } catch (error: any) {
    console.error('Scouting parse error:', error)
    // An upstream failure is not the coach's fault and must not reach
    // them as a raw body — on an Anthropic APIError, error.message IS
    // the JSON response.
    const upstream = describeClaudeFailure(error)
    if (upstream) {
      logClaudeFailure('scouting-parse', error)
      return NextResponse.json(
        { error: upstream.message, retryable: upstream.retryable },
        { status: upstream.status }
      )
    }

    return NextResponse.json(
      { error: error.message || 'Failed to analyze image' },
      { status: 500 }
    )
  }
}
