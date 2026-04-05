import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Your admin email — only this user can access the dashboard
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'clint@mybenchcoach.com'

async function isAdmin(request: NextRequest): Promise<boolean> {
  // Check for admin email via auth
  const authHeader = request.headers.get('x-user-email')
  return authHeader === ADMIN_EMAIL
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const section = searchParams.get('section') || 'overview'

  // Simple email-based auth check
  if (email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    if (section === 'overview') {
      // Total subscribers
      const { data: coaches } = await supabaseAdmin
        .from('coaches')
        .select('id, user_id, display_name, is_subscribed, subscription_tier, stripe_customer_id, created_at')
        .order('created_at', { ascending: false })

      const totalCoaches = coaches?.length || 0
      const activeSubscribers = coaches?.filter(c => c.is_subscribed).length || 0
      const mrr = activeSubscribers * 10 // $10/mo each

      // Signups last 7 days
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const newSignups = coaches?.filter(c => c.created_at > weekAgo).length || 0

      // DAU from events (last 7 days)
      let dailyActiveUsers: any[] = []
      try {
        const { data } = await supabaseAdmin
          .from('admin_daily_active_users')
          .select('*')
          .limit(30)
        dailyActiveUsers = data || []
      } catch (e) { /* view may not exist yet */ }

      // Feature usage
      let featureUsage: any[] = []
      try {
        const { data } = await supabaseAdmin
          .from('admin_feature_usage')
          .select('*')
          .limit(20)
        featureUsage = data || []
      } catch (e) { /* view may not exist yet */ }

      // Fallback: count from actual tables if no events yet
      const { count: totalChats } = await supabaseAdmin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'user')

      const { count: totalPlans } = await supabaseAdmin
        .from('practice_plans')
        .select('id', { count: 'exact', head: true })

      const { count: totalGames } = await supabaseAdmin
        .from('games')
        .select('id', { count: 'exact', head: true })

      let totalLineups = 0
      try {
        const { count } = await supabaseAdmin
          .from('game_lineups')
          .select('id', { count: 'exact', head: true })
        totalLineups = count || 0
      } catch (e) {}

      let totalAnalyses = 0
      try {
        const { count } = await supabaseAdmin
          .from('swing_analyses')
          .select('id', { count: 'exact', head: true })
        totalAnalyses = count || 0
      } catch (e) {}

      let totalPlaybooks = 0
      try {
        const { count } = await supabaseAdmin
          .from('player_playbooks')
          .select('id', { count: 'exact', head: true })
        totalPlaybooks = count || 0
      } catch (e) {}

      let totalJournalEntries = 0
      try {
        const { count } = await supabaseAdmin
          .from('player_journal_entries')
          .select('id', { count: 'exact', head: true })
        totalJournalEntries = count || 0
      } catch (e) {}

      return NextResponse.json({
        overview: {
          totalCoaches,
          activeSubscribers,
          mrr,
          newSignups,
        },
        featureTotals: {
          chats: totalChats || 0,
          practicePlans: totalPlans || 0,
          games: totalGames || 0,
          lineups: totalLineups,
          swingAnalyses: totalAnalyses,
          playbooks: totalPlaybooks,
          journalEntries: totalJournalEntries,
        },
        dailyActiveUsers,
        featureUsage,
        coaches: coaches || [],
      })
    }

    if (section === 'users') {
      // Detailed user activity
      let userActivity: any[] = []
      try {
        const { data } = await supabaseAdmin
          .from('admin_user_activity')
          .select('*')
        userActivity = data || []
      } catch (e) {
        // Fallback: just get coaches with basic info
        const { data: coaches } = await supabaseAdmin
          .from('coaches')
          .select('*')
          .order('created_at', { ascending: false })
        userActivity = (coaches || []).map(c => ({
          user_id: c.user_id,
          display_name: c.display_name,
          is_subscribed: c.is_subscribed,
          subscription_tier: c.subscription_tier,
          signup_date: c.created_at,
          last_active: null,
          events_last_7d: 0,
          events_last_30d: 0,
          active_days_last_30d: 0,
        }))
      }

      return NextResponse.json({ users: userActivity })
    }

    if (section === 'alerts') {
      // Get unread alerts
      const { data: alerts } = await supabaseAdmin
        .from('admin_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      return NextResponse.json({ alerts: alerts || [] })
    }

    if (section === 'generate_alerts') {
      // Generate alerts for inactive users, trial ending, etc.
      const alerts: any[] = []

      // Find inactive subscribers (no events in 7+ days)
      const { data: coaches } = await supabaseAdmin
        .from('coaches')
        .select('user_id, display_name, is_subscribed, created_at')
        .eq('is_subscribed', true)

      if (coaches) {
        for (const coach of coaches) {
          const { data: lastEvent } = await supabaseAdmin
            .from('user_events')
            .select('created_at')
            .eq('user_id', coach.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const lastActive = lastEvent?.created_at || coach.created_at
          const daysSince = Math.floor((Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24))

          if (daysSince >= 14) {
            alerts.push({
              alert_type: 'inactive_user',
              user_id: coach.user_id,
              title: `${coach.display_name || 'User'} inactive for ${daysSince} days`,
              description: `Paying subscriber hasn't been active since ${new Date(lastActive).toLocaleDateString()}. High churn risk.`,
              severity: 'critical',
            })
          } else if (daysSince >= 7) {
            alerts.push({
              alert_type: 'inactive_user',
              user_id: coach.user_id,
              title: `${coach.display_name || 'User'} inactive for ${daysSince} days`,
              description: `Consider sending a check-in email or push notification.`,
              severity: 'warning',
            })
          }
        }
      }

      // Find users who signed up but never used a key feature
      const { data: allCoaches } = await supabaseAdmin
        .from('coaches')
        .select('user_id, display_name, created_at')

      if (allCoaches) {
        for (const coach of allCoaches) {
          const signupAge = Math.floor((Date.now() - new Date(coach.created_at).getTime()) / (1000 * 60 * 60 * 24))
          if (signupAge >= 3 && signupAge <= 14) {
            const { count: chatCount } = await supabaseAdmin
              .from('user_events')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', coach.user_id)
              .eq('event_name', 'chat_message')

            if ((chatCount || 0) === 0) {
              alerts.push({
                alert_type: 'low_engagement',
                user_id: coach.user_id,
                title: `${coach.display_name || 'User'} hasn't used AI chat yet`,
                description: `Signed up ${signupAge} days ago but never sent a chat message. May not understand the value prop.`,
                severity: 'info',
              })
            }
          }
        }
      }

      // Insert new alerts (avoid duplicates by checking recent)
      if (alerts.length > 0) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        for (const alert of alerts) {
          const { data: existing } = await supabaseAdmin
            .from('admin_alerts')
            .select('id')
            .eq('alert_type', alert.alert_type)
            .eq('user_id', alert.user_id)
            .gte('created_at', oneDayAgo)
            .maybeSingle()

          if (!existing) {
            await supabaseAdmin.from('admin_alerts').insert(alert)
          }
        }
      }

      return NextResponse.json({ generated: alerts.length })
    }

    if (section === 'mark_read') {
      const alertId = searchParams.get('alertId')
      if (alertId) {
        await supabaseAdmin
          .from('admin_alerts')
          .update({ is_read: true })
          .eq('id', alertId)
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid section' }, { status: 400 })

  } catch (error: any) {
    console.error('Admin API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
