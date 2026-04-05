'use client'

import { useState, useEffect, useCallback } from 'react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  BarChart3, Users, DollarSign, TrendingUp, AlertTriangle,
  CheckCircle, Clock, MessageSquare, ClipboardList, Trophy,
  Zap, BookOpen, FileText, Eye, EyeOff, RefreshCw, Bell,
  ChevronDown, ChevronUp, Loader2, Shield, Activity
} from 'lucide-react'

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'clint@mybenchcoach.com'

interface OverviewData {
  totalCoaches: number
  activeSubscribers: number
  mrr: number
  newSignups: number
}

interface FeatureTotals {
  chats: number
  practicePlans: number
  games: number
  lineups: number
  swingAnalyses: number
  playbooks: number
  journalEntries: number
}

interface Coach {
  id: string
  user_id: string
  display_name: string | null
  is_subscribed: boolean
  subscription_tier: string | null
  stripe_customer_id: string | null
  created_at: string
}

interface UserActivity {
  user_id: string
  display_name: string | null
  is_subscribed: boolean
  subscription_tier: string | null
  signup_date: string
  last_active: string | null
  events_last_7d: number
  events_last_30d: number
  total_chats: number
  total_plans: number
  total_games: number
  total_lineups: number
  total_analyses: number
  active_days_last_30d: number
}

interface Alert {
  id: string
  alert_type: string
  user_id: string | null
  title: string
  description: string | null
  severity: string
  is_read: boolean
  created_at: string
}

export default function AdminDashboard() {
  const supabase = createSupabaseComponentClient()
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [userEmail, setUserEmail] = useState('')

  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'alerts'>('overview')
  const [loading, setLoading] = useState(true)

  // Data
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [featureTotals, setFeatureTotals] = useState<FeatureTotals | null>(null)
  const [dailyActive, setDailyActive] = useState<any[]>([])
  const [featureUsage, setFeatureUsage] = useState<any[]>([])
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [users, setUsers] = useState<UserActivity[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email === ADMIN_EMAIL) {
        setAuthorized(true)
        setUserEmail(user.email)
      }
      setChecking(false)
    }
    checkAuth()
  }, [supabase])

  // Load data
  const loadOverview = useCallback(async () => {
    if (!userEmail) return
    setLoading(true)
    const res = await fetch(`/api/admin?email=${userEmail}&section=overview`)
    const data = await res.json()
    setOverview(data.overview)
    setFeatureTotals(data.featureTotals)
    setDailyActive(data.dailyActiveUsers || [])
    setFeatureUsage(data.featureUsage || [])
    setCoaches(data.coaches || [])
    setLoading(false)
  }, [userEmail])

  const loadUsers = useCallback(async () => {
    if (!userEmail) return
    const res = await fetch(`/api/admin?email=${userEmail}&section=users`)
    const data = await res.json()
    setUsers(data.users || [])
  }, [userEmail])

  const loadAlerts = useCallback(async () => {
    if (!userEmail) return
    const res = await fetch(`/api/admin?email=${userEmail}&section=alerts`)
    const data = await res.json()
    setAlerts(data.alerts || [])
  }, [userEmail])

  const generateAlerts = async () => {
    if (!userEmail) return
    await fetch(`/api/admin?email=${userEmail}&section=generate_alerts`)
    loadAlerts()
  }

  const markAlertRead = async (alertId: string) => {
    await fetch(`/api/admin?email=${userEmail}&section=mark_read&alertId=${alertId}`)
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true } : a))
  }

  useEffect(() => {
    if (authorized) {
      loadOverview()
      loadAlerts()
    }
  }, [authorized, loadOverview, loadAlerts])

  useEffect(() => {
    if (authorized && activeTab === 'users') {
      loadUsers()
    }
  }, [authorized, activeTab, loadUsers])

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="animate-spin text-red-500" size={32} />
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="text-center">
          <Shield size={48} className="mx-auto mb-4 text-red-500" />
          <h1 className="text-xl font-bold text-white">Access Denied</h1>
          <p className="text-slate-400 mt-2">Admin access only.</p>
        </div>
      </div>
    )
  }

  const unreadAlerts = alerts.filter(a => !a.is_read).length

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
              <Activity size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold">Bench Coach Admin</h1>
              <p className="text-xs text-slate-500">Analytics Dashboard</p>
            </div>
          </div>
          <button
            onClick={() => { loadOverview(); loadAlerts() }}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800 px-4">
        <div className="max-w-6xl mx-auto flex gap-1">
          {([
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'alerts', label: `Alerts${unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}`, icon: Bell },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-red-500 text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            {overview && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KPICard
                  icon={Users}
                  label="Total Coaches"
                  value={overview.totalCoaches.toString()}
                  color="blue"
                />
                <KPICard
                  icon={DollarSign}
                  label="MRR"
                  value={`$${overview.mrr}`}
                  sublabel={`${overview.activeSubscribers} subscribers`}
                  color="green"
                />
                <KPICard
                  icon={TrendingUp}
                  label="New (7d)"
                  value={overview.newSignups.toString()}
                  color="purple"
                />
                <KPICard
                  icon={AlertTriangle}
                  label="Alerts"
                  value={unreadAlerts.toString()}
                  color={unreadAlerts > 0 ? 'red' : 'slate'}
                />
              </div>
            )}

            {/* Feature Usage */}
            {featureTotals && (
              <div>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">All-Time Feature Usage</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <FeatureCard icon={MessageSquare} label="Chat Messages" value={featureTotals.chats} />
                  <FeatureCard icon={ClipboardList} label="Practice Plans" value={featureTotals.practicePlans} />
                  <FeatureCard icon={Trophy} label="Games Logged" value={featureTotals.games} />
                  <FeatureCard icon={Users} label="Lineups" value={featureTotals.lineups} />
                  <FeatureCard icon={Zap} label="Swing Analyses" value={featureTotals.swingAnalyses} />
                  <FeatureCard icon={BookOpen} label="Playbooks" value={featureTotals.playbooks} />
                  <FeatureCard icon={FileText} label="Journal Entries" value={featureTotals.journalEntries} />
                </div>
              </div>
            )}

            {/* DAU Chart */}
            {dailyActive.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Daily Active Users (30d)</h2>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-end gap-1 h-32">
                    {dailyActive.slice(0, 30).reverse().map((d: any, i: number) => {
                      const maxUsers = Math.max(...dailyActive.map((x: any) => x.unique_users), 1)
                      const heightPct = Math.max((d.unique_users / maxUsers) * 100, 4)
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.unique_users} users`}>
                          <div
                            className="w-full bg-red-500 rounded-t opacity-80 hover:opacity-100 transition-opacity"
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-slate-600">
                    <span>30 days ago</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>
            )}

            {/* Recent Coaches */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Signups</h2>
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                {coaches.slice(0, 10).map((coach, i) => (
                  <div key={coach.id} className={`flex items-center justify-between px-4 py-3 ${i % 2 === 0 ? '' : 'bg-slate-800/30'}`}>
                    <div>
                      <span className="text-sm font-medium">{coach.display_name || 'No name'}</span>
                      <span className="text-xs text-slate-500 ml-2">
                        {new Date(coach.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      coach.is_subscribed
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-slate-700 text-slate-400'
                    }`}>
                      {coach.is_subscribed ? (coach.subscription_tier || 'Pro') : 'Free'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">User Activity</h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                    <th className="px-4 py-3">User</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Last Active</th>
                    <th className="px-3 py-3 text-center">7d</th>
                    <th className="px-3 py-3 text-center">30d</th>
                    <th className="px-3 py-3 text-center">Chats</th>
                    <th className="px-3 py-3 text-center">Plans</th>
                    <th className="px-3 py-3 text-center">Games</th>
                    <th className="px-3 py-3">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, i) => {
                    const daysSinceActive = user.last_active
                      ? Math.floor((Date.now() - new Date(user.last_active).getTime()) / (1000 * 60 * 60 * 24))
                      : 999
                    const risk = user.is_subscribed && daysSinceActive >= 14 ? 'critical' :
                      user.is_subscribed && daysSinceActive >= 7 ? 'warning' : 'ok'

                    return (
                      <tr key={user.user_id} className={`border-b border-slate-800/50 ${i % 2 === 0 ? '' : 'bg-slate-800/20'}`}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{user.display_name || 'No name'}</div>
                          <div className="text-[10px] text-slate-500">Joined {new Date(user.signup_date).toLocaleDateString()}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            user.is_subscribed ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                          }`}>
                            {user.is_subscribed ? 'Pro' : 'Free'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-400">
                          {user.last_active
                            ? (daysSinceActive === 0 ? 'Today' : daysSinceActive === 1 ? 'Yesterday' : `${daysSinceActive}d ago`)
                            : 'Never'}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs">{user.events_last_7d || 0}</td>
                        <td className="px-3 py-2.5 text-center text-xs">{user.events_last_30d || 0}</td>
                        <td className="px-3 py-2.5 text-center text-xs">{user.total_chats || 0}</td>
                        <td className="px-3 py-2.5 text-center text-xs">{user.total_plans || 0}</td>
                        <td className="px-3 py-2.5 text-center text-xs">{user.total_games || 0}</td>
                        <td className="px-3 py-2.5">
                          {risk === 'critical' && <span className="text-xs text-red-400 font-medium">🔴 Churn risk</span>}
                          {risk === 'warning' && <span className="text-xs text-yellow-400 font-medium">🟡 Inactive</span>}
                          {risk === 'ok' && <span className="text-xs text-green-400">✓</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No user activity data yet</p>
                  <p className="text-xs mt-1">Data populates as users trigger events</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Alerts</h2>
              <button
                onClick={generateAlerts}
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RefreshCw size={12} /> Generate Alerts
              </button>
            </div>
            <div className="space-y-2">
              {alerts.length === 0 ? (
                <div className="text-center py-12 text-slate-500 bg-slate-900 border border-slate-800 rounded-xl">
                  <Bell size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No alerts</p>
                  <p className="text-xs mt-1">Click "Generate Alerts" to check for issues</p>
                </div>
              ) : (
                alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`bg-slate-900 border rounded-xl p-4 flex items-start gap-3 transition-opacity ${
                      alert.is_read ? 'border-slate-800 opacity-50' : 
                      alert.severity === 'critical' ? 'border-red-800' :
                      alert.severity === 'warning' ? 'border-yellow-800' :
                      'border-slate-700'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      alert.severity === 'critical' ? 'bg-red-500/20' :
                      alert.severity === 'warning' ? 'bg-yellow-500/20' :
                      'bg-blue-500/20'
                    }`}>
                      {alert.severity === 'critical' ? <AlertTriangle size={16} className="text-red-400" /> :
                       alert.severity === 'warning' ? <Clock size={16} className="text-yellow-400" /> :
                       <Activity size={16} className="text-blue-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium">{alert.title}</h3>
                      {alert.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{alert.description}</p>
                      )}
                      <p className="text-[10px] text-slate-600 mt-1">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!alert.is_read && (
                      <button
                        onClick={() => markAlertRead(alert.id)}
                        className="text-xs text-slate-500 hover:text-white flex-shrink-0"
                      >
                        <CheckCircle size={16} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── KPI Card Component ──────────────────────────────

function KPICard({ icon: Icon, label, value, sublabel, color }: {
  icon: any
  label: string
  value: string
  sublabel?: string
  color: string
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    purple: 'bg-purple-500/10 text-purple-400',
    red: 'bg-red-500/10 text-red-400',
    slate: 'bg-slate-700/50 text-slate-400',
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sublabel && <div className="text-[10px] text-slate-600 mt-0.5">{sublabel}</div>}
    </div>
  )
}

// ── Feature Card Component ──────────────────────────

function FeatureCard({ icon: Icon, label, value }: {
  icon: any
  label: string
  value: number
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
      <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0">
        <Icon size={14} className="text-slate-400" />
      </div>
      <div>
        <div className="text-lg font-bold">{value.toLocaleString()}</div>
        <div className="text-[10px] text-slate-500">{label}</div>
      </div>
    </div>
  )
}
