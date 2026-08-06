import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { trackCheckinDue } from '@/lib/gohighlevel'
import { dueState } from '@/lib/checkin'

// Weekly nudge: a priority has run its three weeks and there is a read waiting.
//
// Rules this route exists to enforce, in order of how badly they hurt if broken:
//
//   1. One notification per coach per week, maximum. The loop's value is that
//      it is quiet. An app that emails about youth baseball more than once a
//      week gets muted, and a muted app cannot close its loop at all.
//   2. Never notify about work that wasn't logged. The tag says "there's a
//      check-in ready", full stop. Missed sessions mean the plan was too big,
//      and that is our problem to fix in the next prescription — not something
//      to mention to a parent on a Sunday night.
//   3. Never break the app if GoHighLevel is down. Notification failures are
//      logged and skipped; they never leave a prescription in a state where it
//      can't be checked in from the dashboard.
//
// Scheduled Sunday evening US time (Monday 01:00 UTC) — see vercel.json.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

// Don't re-notify inside a week even if the schedule fires twice (retry,
// redeploy, manual run). Six days rather than seven so a slightly early
// Sunday run isn't silently skipped.
const MIN_DAYS_BETWEEN_NOTIFICATIONS = 6

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // Vercel signs its own cron invocations with this header
  const header = request.headers.get('authorization')
  if (!secret) return false
  return header === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() - MIN_DAYS_BETWEEN_NOTIFICATIONS * 86_400_000).toISOString()

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('prescriptions')
      .select('id, coach_id, scope, player_id, team_id, priority, issued_at, review_due_at, min_hold_until, last_checkin_notified_at')
      .eq('status', 'active')
      .lte('review_due_at', now.toISOString())
      .limit(500)

    if (error) throw error

    const eligible = (rows || []).filter((p: any) =>
      dueState(p, now) !== 'holding' &&
      (!p.last_checkin_notified_at || p.last_checkin_notified_at < cutoff)
    )

    // Group by coach — one email, however many priorities are due.
    const byCoach = new Map<string, any[]>()
    for (const p of eligible) {
      const list = byCoach.get(p.coach_id) || []
      list.push(p)
      byCoach.set(p.coach_id, list)
    }

    let notified = 0
    let skipped = 0
    const failures: string[] = []

    for (const [coachId, prescriptions] of Array.from(byCoach.entries())) {
      try {
        const { data: coach } = await supabaseAdmin
          .from('coaches').select('user_id').eq('id', coachId).maybeSingle()
        if (!coach) { skipped++; continue }

        const { data: userRes } = await supabaseAdmin.auth.admin.getUserById((coach as any).user_id)
        const email = userRes?.user?.email
        if (!email) { skipped++; continue }

        const sent = await trackCheckinDue(email, prescriptions.length)
        if (!sent) { skipped++; continue }

        // Stamp only after the notification actually went out, so a GHL
        // outage retries next week rather than swallowing the nudge.
        await supabaseAdmin
          .from('prescriptions')
          .update({ last_checkin_notified_at: now.toISOString() })
          .in('id', prescriptions.map((p: any) => p.id))

        notified++
      } catch (e: any) {
        console.error('Checkin digest failed for coach', coachId, e?.message)
        failures.push(coachId)
      }
    }

    return NextResponse.json({
      ran_at: now.toISOString(),
      due: eligible.length,
      coaches_notified: notified,
      coaches_skipped: skipped,
      failures: failures.length,
    })
  } catch (error: any) {
    console.error('Checkin digest error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
