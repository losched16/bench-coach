import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateReplacementBlock } from '@/lib/anthropic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { teamId, ageGroup, blockToReplace, otherBlocks, coachNote } = await request.json()

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
      .limit(100)

    const block = await generateReplacementBlock(
      ageGroup,
      blockToReplace,
      otherBlocks || [],
      coachNote || '',
      drillResources || []
    )

    return NextResponse.json(block)
  } catch (error: any) {
    console.error('Swap drill API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate replacement drill' },
      { status: 500 }
    )
  }
}
