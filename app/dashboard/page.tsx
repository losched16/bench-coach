'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Link from 'next/link'

import { MessageSquare, ClipboardList, Users, FileText, Calendar, Target } from 'lucide-react'
import { usePageView } from '@/lib/tracking'
import { ActivePriority, ActivePriorityItem } from '@/components/ActivePriority'

interface TeamData {
  team: any
  playerCount: number
  recentPlans: any[]
  topIssues: any[]
}

function DashboardContent() {
  const [data, setData] = useState<TeamData | null>(null)
  // What's live: the priority being worked, with the log button on it, and the
  // check-in CTA once there's something to check. If this isn't on the
  // dashboard the loop only closes when someone remembers it exists.
  const [priorities, setPriorities] = useState<ActivePriorityItem[]>([])
  const [coachId, setCoachId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
  const router = useRouter()
  const teamId = searchParams.get('teamId')
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

      loadPriorities()
    } catch (error) {
      console.error('Error loading dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  // Deliberately separate and non-blocking: a missing check-in table or a slow
  // response must never keep the dashboard from rendering.
  const loadPriorities = async (cid?: string) => {
    try {
      let id = cid || coachId
      if (!id) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: coach } = await supabase
          .from('coaches').select('id').eq('user_id', user.id).single() as { data: { id: string } | null }
        if (!coach) return
        id = coach.id
        setCoachId(coach.id)
      }

      const params = new URLSearchParams({ coachId: id })
      if (teamId) params.set('teamId', teamId)
      const res = await fetch(`/api/checkin?${params}`)
      const json = await res.json()
      setPriorities(json.prescriptions || [])
    } catch {
      // no card is the correct failure mode here
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

  const quickActions = [
    // First, because it's the front door to the loop — and until now the only
    // way to reach it from here was the sidebar.
    {
      label: 'What to Work On',
      icon: Target,
      href: `/dashboard/prescribe?teamId=${teamId}`,
      color: 'red',
    },
    {
      label: 'Log an Entry',
      icon: ClipboardList,
      href: `/dashboard/log?teamId=${teamId}`,
      color: 'red',
    },
    {
      label: 'Open Chat',
      icon: MessageSquare,
      href: `/dashboard/chat?teamId=${teamId}`,
      color: 'blue',
    },
    {
      label: 'Plan Practice',
      icon: ClipboardList,
      href: `/dashboard/practice?teamId=${teamId}`,
      color: 'green',
    },
    {
      label: 'Game Day',
      icon: Calendar,
      href: `/dashboard/lineup?teamId=${teamId}`,
      color: 'red',
    },
    {
      label: 'View Roster',
      icon: Users,
      href: `/dashboard/roster?teamId=${teamId}`,
      color: 'purple',
    },
    {
      label: 'Team Notes',
      icon: FileText,
      href: `/dashboard/notes?teamId=${teamId}`,
      color: 'orange',
    },
  ]

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">
          {data.team.name}
        </h2>
        <p className="text-sm sm:text-base text-gray-600">
          {data.team.season?.name || 'Season'} • {data.team.age_group} • {data.team.skill_level}
        </p>
      </div>

      {/* The live priority (or priorities), each with its log button. Ready-to-
          check-in ones sort first — that's the action that matters most. */}
      {coachId && priorities.length > 0 && (
        <div className="space-y-4">
          {priorities
            .slice()
            .sort((a, b) => {
              const rank = (p: ActivePriorityItem) => (p.due !== 'holding' && p.hasEvidence ? 0 : 1)
              return rank(a) - rank(b)
            })
            .slice(0, 3)
            .map((p) => (
              <ActivePriority
                key={p.id}
                item={p}
                coachId={coachId}
                teamId={teamId}
                onLogged={() => loadPriorities(coachId)}
              />
            ))}
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        <div className="bg-white rounded-lg shadow p-4 sm:p-6">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">Players</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900">{data.playerCount}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 sm:p-6">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">Duration</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900">{data.team.practice_duration_minutes || 60}<span className="text-sm sm:text-base font-normal">m</span></div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 sm:p-6">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">Plans</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900">{data.recentPlans.length}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.label}
                href={action.href}
                className={`bg-white rounded-lg shadow p-4 sm:p-6 hover:shadow-md transition-shadow flex flex-col items-center text-center space-y-2 sm:space-y-3`}
              >
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-${action.color}-100 flex items-center justify-center`}>
                  <Icon className={`text-${action.color}-600`} size={20} />
                </div>
                <span className="font-medium text-gray-900 text-sm sm:text-base">{action.label}</span>
              </Link>
            )
          })}
        </div>
      </div>

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