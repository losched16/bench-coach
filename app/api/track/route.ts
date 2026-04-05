import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// POST: Log a user event
export async function POST(request: NextRequest) {
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
