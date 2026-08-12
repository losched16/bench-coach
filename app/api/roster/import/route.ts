import { NextRequest, NextResponse } from 'next/server'
import { textFrom } from '@/lib/claudeText'
import { requireSession } from '@/lib/authz'
import { claude as anthropic, describeClaudeFailure, logClaudeFailure } from '@/lib/claudeClient'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Vision and generation calls take real time now that thinking is on by
// default. Without this the platform kills the function at its 15s default
// and the user sees a failure that has nothing to do with their input.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const { image, mimeType } = await request.json()

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/png',
                data: image,
              },
            },
            {
              type: 'text',
              text: `Analyze this screenshot of a sports team roster. Extract all player information you can see.

For each player, extract:
- name (required)
- jersey_number (if visible)
- positions (if visible, as array like ["SS", "2B"])

Return ONLY a valid JSON array, no other text. Example format:
[
  {"name": "Tommy Smith", "jersey_number": "12", "positions": ["SS"]},
  {"name": "Jake Johnson", "jersey_number": "7", "positions": ["1B", "P"]}
]

If you cannot find any players or the image doesn't show a roster, return an empty array: []

Important:
- Extract ALL players visible in the image
- If jersey numbers aren't shown, omit that field
- If positions aren't shown, omit that field or set to empty array
- Clean up names (proper capitalization)
- Return ONLY the JSON array, nothing else`,
            },
          ],
        },
      ],
      // Reading names off a roster screenshot is not a reasoning problem;
      // thinking spend here is pure latency.
      output_config: { effort: 'low' },
    })

    const text = textFrom(response)
    if (!text) {
      return NextResponse.json({ error: 'No response from the reader. Try again.' }, { status: 500 })
    }

    // Parse the JSON response
    let players = []
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        players = JSON.parse(jsonMatch[0])
      } else {
        players = JSON.parse(text)
      }
    } catch (e) {
      console.error('Failed to parse player data:', text)
      return NextResponse.json({
        error: 'Could not parse roster data from image. Please try a clearer screenshot.',
        raw: text
      }, { status: 400 })
    }

    // Validate and clean the data
    const cleanedPlayers = players
      .filter((p: any) => p.name && typeof p.name === 'string')
      .map((p: any) => ({
        name: p.name.trim(),
        jersey_number: p.jersey_number ? String(p.jersey_number).trim() : null,
        positions: Array.isArray(p.positions) ? p.positions : [],
      }))

    return NextResponse.json({ 
      players: cleanedPlayers,
      count: cleanedPlayers.length 
    })

  } catch (error: any) {
    console.error('Roster import error:', error)
    // An upstream failure is not the coach's fault and must not reach
    // them as a raw body — on an Anthropic APIError, error.message IS
    // the JSON response.
    const upstream = describeClaudeFailure(error)
    if (upstream) {
      logClaudeFailure('roster-import', error)
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
