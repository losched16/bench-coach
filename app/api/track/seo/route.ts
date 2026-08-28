import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Anonymous events from the public marketing pages.
//
// The sibling route at /api/track requires a session, which is right for it —
// every dashboard event belongs to a coach. This one deliberately does not,
// because the people it measures have not signed up yet. That is the entire
// funnel we are trying to see.
//
// Being open to anyone means it is also open to abuse, so it accepts as
// little as possible: a name from a fixed list, a path, and a handful of
// known string fields, all length-capped. Nothing here is interpolated into
// SQL, rendered anywhere, or trusted. Anything unrecognised is dropped rather
// than stored, which keeps the table something you can still read in six
// months.
//
// No user id, no IP, no cookie. These events answer "how many people printed
// the 8U practice plan", and that question does not need a person attached.

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const ALLOWED = new Set([
  'practice_print',
  'practice_customize',
  'practice_generate',
  'drill_add_to_practice',
  'related_resource_click',
  'seo_to_app_cta',
])

const META_KEYS = ['age_group', 'resource_type', 'drill_name', 'location', 'destination']

function clean(v: unknown, max = 120): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t || undefined
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const eventName = clean(body?.eventName, 60)
    if (!eventName || !ALLOWED.has(eventName)) {
      // Deliberately still a 204. A rejected event is not the caller's problem
      // to solve, and an error status would only invite retries.
      return new NextResponse(null, { status: 204 })
    }

    const metadata: Record<string, string> = {}
    for (const key of META_KEYS) {
      const value = clean(body?.metadata?.[key])
      if (value) metadata[key] = value
    }

    await supabaseAdmin.from('user_events').insert({
      user_id: null,
      event_type: 'seo',
      event_name: eventName,
      page_path: clean(body?.pagePath, 200) || null,
      metadata: Object.keys(metadata).length ? metadata : null,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    // Tracking never fails loudly. If user_events still has NOT NULL on
    // user_id, this is where that lands — migration 044 removes it, and until
    // it runs the events are simply not recorded.
    console.warn('SEO event tracking error:', error?.message)
    return new NextResponse(null, { status: 204 })
  }
}
