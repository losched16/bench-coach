'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Link from 'next/link'

import { MessageSquare, ClipboardList, Users, Calendar, Target, FileText } from 'lucide-react'
import { usePageView } from '@/lib/tracking'
import { PrioritiesBoard } from '@/components/PrioritiesBoard'

interface TeamData {
  team: any
  playerCount: number
  recentPlans: any[]
  topIssues: any[]
}

function DashboardContent() {
  const [data, setData] = useState<TeamData | null>(null)
  const [coachId, setCoachId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
  const router = useRouter()
  const teamId = searchParams.get('teamId')
  // Redirected here from the old /dashboard/checkin deep links.
  const focusId = searchParams.get('prescriptionId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadDashboardData()
    }
  }, [teamId])

  const loadDashboardData = async () => {
    try {
      // Load team
      const { data: team } = await supabase
        .from('teams')
        .select(`
          *,
          season:seasons(name)
        `)
        .eq('id', teamId)
        .single()

      // Count players
      const { count: playerCount } = await supabase
        .from('team_players')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', teamId)

      // Get recent practice plans
      const { data: recentPlans } = await supabase
        .from('practice_plans')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })
        .limit(3)

      // Get pinned notes
      const { data: topIssues } = await supabase
        .from('team_notes')
        .select('*')
        .eq('team_id', teamId)
        .eq('pinned', true)
        .order('created_at', { ascending: false })
        .limit(3)

      setData({
        team,
        playerCount: playerCount || 0,
        recentPlans: recentPlans || [],
        topIssues: topIssues || [],
      })

    } catch (error) {
      console.error('Error loading dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading dashboard...</div>
  }

  if (!data || !data.team) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to load team</h2>
        <p className="text-gray-600">Please select a team from the sidebar or check your access.</p>
      </div>
    )
  }

  // A row, not a screen. Anything that is its own destination lives in the
  // sidebar; this is just the short path to the three things a coach opens the
  // app to do that aren't already on this page.
  const quickActions = [
    { label: 'Ask CoachAI', icon: MessageSquare, href: `/dashboard/chat?teamId=${teamId}` },
    { label: 'Log an Entry', icon: ClipboardList, href: `/dashboard/log?teamId=${teamId}` },
    { label: 'Plan Practice', icon: FileText, href: `/dashboard/practice?teamId=${teamId}` },
    { label: 'Game Day', icon: Calendar, href: `/dashboard/game?teamId=${teamId}` },
    { label: 'Roster', icon: Users, href: `/dashboard/roster?teamId=${teamId}` },
  ]

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
          {data.team.name}
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          {data.team.season?.name || 'Season'} • {data.team.age_group} • {data.team.skill_level}
        </p>

        {/* Above the fold and out of the way. A grid of large tiles pushed the
            actual work below the scroll. */}
        <div className="flex gap-2 overflow-x-auto mt-4 -mx-1 px-1 pb-1">
          {quickActions.map(action => {
            const Icon = action.icon
            return (
              <Link
                key={action.label}
                href={action.href}
                className="shrink-0 inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-800 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                <Icon size={15} className="text-gray-400" />
                {action.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* What's being worked on, with the drills, the log button, and the read
          on whether it moved. This is the answer to "what am I looking at" —
          it belongs above everything else on the page rather than on a second
          screen you have to remember to visit. */}
      <PrioritiesBoard teamId={teamId} focusId={focusId} />

      {/* Team reference. Real information, but not the job — three cards
          stacked under the plans turned the page into a scroll where the thing
          you came for was the shortest part of it. One line, closed. */}
      {(data.team.primary_goals?.length > 0 || data.topIssues.length > 0 || data.recentPlans.length > 0) && (
        <details className="bg-white rounded-lg shadow-sm border border-gray-200">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 select-none">
            Season goals, pinned issues and recent practice plans
          </summary>
          <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {/* Primary Goals */}
          {data.team.primary_goals && data.team.primary_goals.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Season Goals</h3>
              <div className="flex flex-wrap gap-2">
                {data.team.primary_goals.map((goal: string) => (
                  <span
                    key={goal}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm capitalize"
                  >
                    {goal}
                  </span>
                ))}
              </div>
            </div>
          )}

              {/* Top Issues */}
          {data.topIssues.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Pinned Issues</h3>
              <div className="space-y-3">
                {data.topIssues.map((issue) => (
                  <div key={issue.id} className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-red-500 rounded-full mt-2"></div>
                    <div className="flex-1">
                      {issue.title && <div className="font-medium text-gray-900">{issue.title}</div>}
                      <div className="text-gray-600 text-sm">{issue.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

              {/* Recent Practice Plans */}
          {data.recentPlans.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Recent Practice Plans</h3>
                <Link
                  href={`/dashboard/practice?teamId=${teamId}`}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  View all
                </Link>
              </div>
              <div className="space-y-3">
                {data.recentPlans.map((plan) => (
                  <div key={plan.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div>
                      <div className="font-medium text-gray-900">{plan.title}</div>
                      <div className="text-sm text-gray-600">{plan.duration_minutes} minutes</div>
                    </div>
                    <Link
                      href={`/dashboard/practice/${plan.id}?teamId=${teamId}`}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      View
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          </div>
        </details>
      )}

    </div>
  )
}

export default function DashboardPage() {
  usePageView('home')
  return (
    <Suspense fallback={<div className="text-gray-600">Loading dashboard...</div>}>
      <DashboardContent />
    </Suspense>
  )
}