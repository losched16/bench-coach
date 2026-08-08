import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateReplacementBlock } from '@/lib/anthropic'
import { guard } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Vision and generation calls take real time now that thinking is on by
// default. Without this the platform kills the function at its 15s default
// and the user sees a failure that has nothing to do with their input.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const { teamId, ageGroup, blockToReplace, otherBlocks, coachNote, count } = await request.json()

    if (!blockToReplace || !ageGroup) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Load drill resources for video matching
    const { data: drillResources } = await supabaseAdmin
      .from('drill_resources')
      .select('drill_name, skill_category, description, youtube_url, youtube_video_id, channel, age_range, difficulty_level, mechanic_focus, common_flaws_fixed, equipment_needed, ai_coaching_notes, safety_notes')
      .or('status.eq.approved,status.is.null')
      .limit(100)

    // Three, generated in parallel and told to differ from each other. One
    // forced replacement means a coach who doesn't like it has to roll again
    // and hope; three means they choose.
    const want = Math.min(Math.max(Number(count) || 1, 1), 3)

    if (want === 1) {
      const block = await generateReplacementBlock(
        ageGroup, blockToReplace, otherBlocks || [], coachNote || '', drillResources || []
      )
      return NextResponse.json(block)
    }

    const ANGLES = [
      'Closest to the original in setup and equipment — the coach liked the slot, not this drill.',
      'A different way at the same skill. If the original was static, make this one live or competitive.',
      'The simplest possible version. Assume no extra equipment and a short attention span.',
    ]

    const results = await Promise.allSettled(
      Array.from({ length: want }, (_, i) =>
        generateReplacementBlock(
          ageGroup,
          blockToReplace,
          // Each generation avoids the others' angle by seeing the same
          // "don't duplicate" list, plus its own brief.
          otherBlocks || [],
          `${coachNote || ''}\n\nANGLE FOR THIS SUGGESTION: ${ANGLES[i]}`.trim(),
          drillResources || []
        )
      )
    )

    const options = results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value)
      .filter(Boolean)

    if (options.length === 0) {
      return NextResponse.json({ error: 'Could not generate alternatives' }, { status: 500 })
    }

    // Two identical titles is worse than two options.
    const seen = new Set<string>()
    const unique = options.filter(o => {
      const key = String(o.title || '').toLowerCase().trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    return NextResponse.json({ options: unique })
  } catch (error: any) {
    console.error('Swap drill API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate replacement drill' },
      { status: 500 }
    )
  }
}
