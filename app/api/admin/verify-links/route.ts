import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/authz'

// Build 0 link-integrity check, runnable from a phone: hits YouTube oEmbed
// for each drill video server-side (the deployed environment has open
// egress; local sandboxes may not). Mirrors scripts/verify-drill-links.mjs.
//
//   GET /api/admin/verify-links?email=<admin>            -> check pending_review drills
//   GET /api/admin/verify-links?email=<admin>&scope=all  -> check every drill
//   GET /api/admin/verify-links?email=<admin>&write=1    -> also stamp url_verified_at on passes

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

async function oembedStatus(videoId: string): Promise<number | string> {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    return res.status
  } catch (e: any) {
    return `ERR:${e.name}`
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  // The ?email= check that used to live here was the same published-password
  // pattern as /api/admin — requireAdmin() above replaces it with the session.
  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') || 'pending'
  const write = searchParams.get('write') === '1'

  try {
    let query = supabaseAdmin
      .from('drill_resources')
      .select('id, drill_name, youtube_video_id, status')
      .limit(1000)
    if (scope !== 'all') query = query.eq('status', 'pending_review')

    const { data: drills, error } = await query
    if (error) throw error
    if (!drills || drills.length === 0) {
      return NextResponse.json({
        checked: 0,
        message: scope === 'all'
          ? 'No drills found.'
          : 'No pending_review drills found — run migration 011 first, or use scope=all.',
      })
    }

    // Batched concurrency keeps 200+ videos inside the function timeout
    const results: Array<{ id: string; drill_name: string; youtube_video_id: string; oembed: number | string }> = []
    const BATCH = 10
    for (let i = 0; i < drills.length; i += BATCH) {
      const batch = drills.slice(i, i + BATCH)
      const statuses = await Promise.all(batch.map(d => oembedStatus(d.youtube_video_id)))
      batch.forEach((d, j) => results.push({ ...d, oembed: statuses[j] }))
    }

    const failures = results.filter(r => r.oembed !== 200)
    const passes = results.filter(r => r.oembed === 200)

    if (write && passes.length > 0) {
      const now = new Date().toISOString()
      for (let i = 0; i < passes.length; i += 50) {
        const ids = passes.slice(i, i + 50).map(p => p.id)
        await supabaseAdmin.from('drill_resources').update({ url_verified_at: now }).in('id', ids)
      }
    }

    return NextResponse.json({
      checked: results.length,
      passed: passes.length,
      failed: failures.length,
      failures: failures.map(f => ({
        drill_name: f.drill_name,
        youtube_video_id: f.youtube_video_id,
        oembed: f.oembed,
      })),
      verified_stamped: write ? passes.length : 0,
      note:
        failures.length > 2
          ? 'More than 2 failures — per Build 0, re-validate the whole set (scope=all).'
          : failures.length > 0
            ? 'Fix failing rows (new video) or set status=rejected before approving.'
            : 'All links healthy.',
    })
  } catch (error: any) {
    console.error('verify-links error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
