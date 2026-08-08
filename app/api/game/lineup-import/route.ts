import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { textFrom } from '@/lib/claudeText'
import { matchRosterPlayer, RosterCandidate } from '@/lib/entries'
import { migrationHintFor } from '@/lib/migrationHints'

// Reading a lineup off a picture.
//
// Before a game a coach is handed, or shown, a batting order: a GameChanger
// screen, a SportsEngine page, the other coach's handwritten book, a printed
// card taped to a fence. Typing nine or twelve names into a phone in that
// moment is the difference between keeping the book and not bothering.
//
// Two rules shape this route.
//
//   It never saves anything. It reads the picture and hands back what it
//   thinks it saw, with a confidence and a list of what it struggled with.
//   The coach commits it. A roster silently populated from a blurry photo is
//   worse than an empty one, because the errors are invisible until the third
//   inning.
//
//   It extracts only what is printed on a lineup card — order, name, number,
//   position. Nothing about how anyone plays, on either team. For the other
//   team that is a deliberate boundary, not an oversight: this exists so the
//   book can say a name instead of "#4", and for nothing else.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Vision on a photographed page is slower than a text call, and a coach who
// gets a timeout goes back to typing.
export const maxDuration = 120

function buildPrompt(side: 'us' | 'them', teamName: string | null, imageCount: number): string {
  const whose = side === 'us'
    ? `the lineup for "${teamName || 'the coach’s own team'}"`
    : 'the OPPOSING team’s lineup'

  return `${imageCount === 1 ? 'This image is' : `These ${imageCount} images are`} a youth baseball batting order. It might be a GameChanger or SportsEngine screenshot, a printed lineup card, or a photograph of a handwritten scorebook page.

Extract ${whose}.

Return ONLY valid JSON, no other text:
{
  "players": [
    {
      "slot": 1,
      "name": "name exactly as written",
      "jersey": "12 or null",
      "position": "P|C|1B|2B|3B|SS|LF|CF|RF|DH|EH or null",
      "is_pitcher": false,
      "uncertain": ["name"]
    }
  ],
  "team_name": "the team name if one is visible, else null",
  "confidence": "high|medium|low",
  "warnings": ["anything cut off, smudged, or ambiguous"]
}

Rules that matter:

- "slot" is the batting order position, 1-based, in the order printed. If the
  image shows a fielding chart with no batting order, set slot in the order the
  rows appear and say so in warnings.

- NEVER invent a name. Handwriting is often unreadable — if you cannot read a
  row, still include it with "name": null so the slot is preserved, and list it
  in warnings. A blank the coach fills in beats a guess they do not notice.

- "uncertain" lists fields on that row you had to interpret. Handwritten pages
  should have a lot of these. Flagging honestly is more useful than looking
  confident; the coach reviews every row before it saves.

- Extract only what is printed: order, name, number, position. Do NOT infer or
  comment on how any player performs, and do not add fields.

- Positions may be written as scorekeeping numbers (1 = P, 2 = C, 3 = 1B,
  4 = 2B, 5 = 3B, 6 = SS, 7 = LF, 8 = CF, 9 = RF). Convert them.

- If a page shows both teams, extract ${side === 'us' ? 'the one matching the team name above' : 'the team that is NOT the coach’s'} and note the ambiguity in warnings.

- If the image is not a lineup at all, return {"players": [], "confidence": "low", "warnings": ["not a lineup"]}.`
}

export async function POST(request: NextRequest) {
  try {
    const { images, side, teamId, gameId } = await request.json()

    const imageList = Array.isArray(images) ? images : []
    if (imageList.length === 0) {
      return NextResponse.json({ error: 'No image to read' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const which: 'us' | 'them' = side === 'us' ? 'us' : 'them'

    // Our own roster, so parsed names come back already matched to real
    // players. Theirs has nothing to match against and needs none.
    let roster: RosterCandidate[] = []
    let savedMappings: Record<string, string> = {}
    let teamName: string | null = null

    if (which === 'us' && teamId) {
      const [teamRes, rosterRes, mappingRes] = await Promise.all([
        supabaseAdmin.from('teams').select('name').eq('id', teamId).maybeSingle(),
        supabaseAdmin
          .from('team_players')
          .select('id, player:players(name, jersey_number)')
          .eq('team_id', teamId),
        supabaseAdmin.from('roster_name_mappings').select('source_name, team_player_id'),
      ])
      teamName = (teamRes.data as any)?.name || null
      roster = ((rosterRes.data || []) as any[])
        .map(tp => ({
          team_player_id: tp.id,
          name: tp.player?.name || '',
          jersey_number: tp.player?.jersey_number ?? null,
        }))
        .filter(r => r.name)
      for (const m of (mappingRes.data || []) as any[]) {
        savedMappings[String(m.source_name).trim().toLowerCase()] = m.team_player_id
      }
    }

    const content: any[] = imageList.slice(0, 4).map((img: any) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mimeType || 'image/png', data: img.data },
    }))
    content.push({ type: 'text', text: buildPrompt(which, teamName, content.length) })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      // A truncated lineup is unparseable JSON rather than a partial one, and
      // thinking spends from the same budget.
      max_tokens: 8000,
      messages: [{ role: 'user', content }],
      // Handwriting is genuinely hard to read. This is the one place in the
      // app where a little more thinking earns its latency.
      output_config: { effort: 'medium' },
    })

    const raw = textFrom(response)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({
        players: [], parseFailed: true,
        message: "Couldn't read a lineup in that. You can still type it in.",
      })
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({
        players: [], parseFailed: true,
        message: "Couldn't read a lineup in that. You can still type it in.",
      })
    }

    const rows = Array.isArray(parsed.players) ? parsed.players : []

    // Attach roster matches so our own import opens pre-filled and correctable
    // rather than as a list of strings to re-key.
    const players = rows.map((p: any, i: number) => {
      const base = {
        slot: Number(p.slot) > 0 ? Number(p.slot) : i + 1,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null,
        jersey: p.jersey != null && String(p.jersey).trim() ? String(p.jersey).trim() : null,
        position: typeof p.position === 'string' && p.position.trim() ? p.position.trim().toUpperCase() : null,
        is_pitcher: !!p.is_pitcher,
        uncertain: Array.isArray(p.uncertain) ? p.uncertain : [],
      }
      if (which !== 'us' || !base.name || roster.length === 0) {
        return { ...base, team_player_id: null, matchConfidence: 'none' as const }
      }
      const m = matchRosterPlayer(base.name, base.jersey, roster, savedMappings)
      return { ...base, team_player_id: m.team_player_id, matchConfidence: m.confidence }
    })

    return NextResponse.json({
      players,
      side: which,
      teamNameSeen: parsed.team_name || null,
      confidence: parsed.confidence || 'medium',
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      roster: roster.map(r => ({ id: r.team_player_id, name: r.name, jersey: r.jersey_number })),
    })
  } catch (error: any) {
    console.error('Lineup import error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not read that lineup' },
      { status: 500 }
    )
  }
}
