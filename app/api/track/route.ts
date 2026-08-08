import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireSession } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// POST: Log a user event
export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const body = await request.json()
    const { userId, eventType, eventName, pagePath, metadata } = body

    if (!userId || !eventName) {
      return NextResponse.json({ error: 'userId and eventName required' }, { status: 400 })
    }

    await supabaseAdmin
      .from('user_events')
      .insert({
        user_id: userId,
        event_type: eventType || 'feature_use',
        event_name: eventName,
        page_path: pagePath || null,
        metadata: metadata || null,
      })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    // Don't let tracking errors break the app
    console.warn('Event tracking error:', error.message)
    return NextResponse.json({ ok: true })
  }
}
