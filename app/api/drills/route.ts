import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireSession, callerCoachId } from '@/lib/authz'
import { visibleDrills, schedulableDrills } from '@/lib/drills'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const { searchParams } = new URL(request.url)
    // Whose library this is. Read off the session rather than a query
    // parameter — a caller does not get to name a coach and see their drills.
    const coachId = await callerCoachId()
    const name = searchParams.get('name')
    const names = searchParams.get('names') // Comma-separated list
    const category = searchParams.get('category')

    // If looking up multiple drills by name
    if (names) {
      const nameList = names.split(',').map(n => n.trim().toLowerCase())
      
      const { data: drills } = await visibleDrills(supabaseAdmin, coachId, 'id, drill_name, youtube_video_id, youtube_url, thumbnail_url, channel, description, skill_category, difficulty_level, common_flaws_fixed, ai_coaching_notes')

      // Fuzzy match each name
      const matched = nameList.map(searchName => {
        return drills?.find((d: any) => 
          d.drill_name.toLowerCase() === searchName ||
          d.drill_name.toLowerCase().includes(searchName) ||
          searchName.includes(d.drill_name.toLowerCase())
        ) || null
      }).filter(Boolean)

      return NextResponse.json({ drills: matched })
    }

    // Single drill lookup
    if (name) {
      const { data: drills } = await visibleDrills(supabaseAdmin, coachId, 'id, drill_name, youtube_video_id, youtube_url, thumbnail_url, channel, description, skill_category, difficulty_level, common_flaws_fixed, ai_coaching_notes')

      // Fuzzy match
      const drill = drills?.find((d: any) => 
        d.drill_name.toLowerCase() === name.toLowerCase() ||
        d.drill_name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(d.drill_name.toLowerCase())
      )

      if (drill) {
        return NextResponse.json({ drill })
      }
      return NextResponse.json({ drill: null })
    }

    // Get all drills (optionally filtered by category).
    //
    // This is the browse/pick path — discovery — so it goes through
    // schedulableDrills. The two by-name lookups above deliberately do NOT:
    // they resolve a name that already appears in a saved plan or a model's
    // output, and a block whose drill was later classified still has to find
    // its video.
    // ?include=all returns the demoted rows too, with resource_kind, so ONE
    // cached fetch can serve both jobs: the client browses the schedulable
    // rows and still resolves a name that a saved plan already contains.
    // Two of the fifteen practice plans in production today name a row this
    // change demotes; without this they would lose their video card.
    const includeAll = searchParams.get('include') === 'all'
    const fields = 'id, drill_name, youtube_video_id, youtube_url, thumbnail_url, channel, description, skill_category, difficulty_level, common_flaws_fixed, ai_coaching_notes' +
      (includeAll ? ', resource_kind' : '')

    // Spelled out as two branches rather than picking the helper with a
    // ternary. A ternary reads fine and is invisible to grep — and grep is
    // exactly how scripts/verify-drill-scope.mjs proves every library read goes
    // through the coach-privacy boundary. A control that a clever line can slip
    // past is not a control.
    let query = includeAll
      ? visibleDrills(supabaseAdmin, coachId, fields)
      : schedulableDrills(supabaseAdmin, coachId, fields)
    query = query.order('skill_category').order('drill_name')

    if (category) {
      query = query.eq('skill_category', category)
    }

    const { data: drills, error } = await query

    if (error) throw error

    return NextResponse.json({ drills: drills || [] })

  } catch (error: any) {
    console.error('Drill lookup error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to lookup drills' },
      { status: 500 }
    )
  }
}
