'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useRole } from '@/lib/useRole'
import { useEntitlements } from '@/lib/useEntitlements'
import Link from 'next/link'
import Image from 'next/image'
import { CaptureMenu } from '@/components/CaptureMenu'
import { MessageSquare, Users, StickyNote, ClipboardList, Home, LogOut, Plus, UserPlus, Trash2, Settings, Bookmark, HelpCircle, Brain, UsersRound, UserCircle, Menu, X, Calendar, BarChart3, Activity, Target, Search, CalendarCheck, Timer } from 'lucide-react'


interface Team {
  id: string
  name: string
  age_group: string
  season: {
    name: string
  }
}

function DashboardContent({
  children,
}: {
  children: React.ReactNode
}) {
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showDeleteTeamModal, setShowDeleteTeamModal] = useState(false)
  const [canCreate, setCanCreate] = useState(false)
  const [coachId, setCoachId] = useState<string>('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = createSupabaseComponentClient()

  // What this user may do on the team they're looking at. Menu items they can
  // never use are not shown — an assistant coach hunting for Staff and finding
  // a refusal has learned nothing except that the app argues with them.
  const { role, label: roleLabel, can: allowed } = useRole(selectedTeamId)

  // What the plan includes, which is a different question from what the role
  // allows. Role says "an assistant coach may not open Staff"; this says "a
  // Personal subscriber has no staff to manage in the first place". Both hide
  // menu items, and both are only about what to SHOW — the routes refuse
  // independently, so a typed URL gets the same answer.
  const { teamFeatures } = useEntitlements(coachId)

  // Get teamId from URL or use first team
  const urlTeamId = searchParams.get('teamId')

  useEffect(() => {
    loadTeams()
  }, [])

  // Reload teams if URL has a teamId we don't recognize (new team was created)
  useEffect(() => {
    if (!loading && urlTeamId && teams.length > 0) {
      const teamExists = teams.find(t => t.id === urlTeamId)
      if (!teamExists) {
        // New team was created, reload the list
        loadTeams()
      }
    }
  }, [urlTeamId, loading, teams])

  // When teams load, set the selected team and update URL if needed
  useEffect(() => {
    if (teams.length > 0 && !loading) {
      const teamIdToUse = urlTeamId && teams.find(t => t.id === urlTeamId) 
        ? urlTeamId 
        : teams[0].id
      
      setSelectedTeamId(teamIdToUse)
      
      // If no teamId in URL, add it
      if (!urlTeamId) {
        router.replace(`${pathname}?teamId=${teamIdToUse}`)
      }
    }
  }, [teams, loading, urlTeamId, pathname])

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  const loadTeams = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }

      // Check for pending invite - redirect there first
      const pendingInvite = sessionStorage.getItem('pendingInviteToken')
      if (pendingInvite) {
        router.push(`/invite/${pendingInvite}`)
        return
      }

      const { data: coach } = await supabase
        .from('coaches')
        .select('id, is_subscribed')
        .eq('user_id', user.id)
        .single()

      if (!coach) {
        router.push('/onboarding')
        return
      }

      setCoachId(coach.id)

      // Get teams user OWNS
      const { data: ownedTeams } = await supabase
        .from('teams')
        .select(`
          id,
          name,
          age_group,
          season:seasons(name)
        `)
        .eq('coach_id', coach.id)
        .order('created_at', { ascending: false })

      // Get team IDs user is a MEMBER of (simple query first)
      const { data: memberships } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id)

      // Fetch those teams separately if there are memberships
      let memberTeamsList: Team[] = []
      if (memberships && memberships.length > 0) {
        const teamIds = memberships.map(m => m.team_id)
        const { data: memberTeamsData } = await supabase
          .from('teams')
          .select(`
            id,
            name,
            age_group,
            season:seasons(name)
          `)
          .in('id', teamIds)
        
        if (memberTeamsData) {
          memberTeamsList = memberTeamsData as Team[]
        }
      }

      // Combine and dedupe teams
      const allTeams: Team[] = []
      
      if (ownedTeams) {
        allTeams.push(...ownedTeams as Team[])
      }
      
      memberTeamsList.forEach((team) => {
        if (!allTeams.find(t => t.id === team.id)) {
          allTeams.push(team)
        }
      })

      // User can create if they own teams OR are subscribed
      const ownsTeams = ownedTeams && ownedTeams.length > 0
      setCanCreate(ownsTeams || coach.is_subscribed === true)

      if (allTeams.length > 0) {
        setTeams(allTeams)
      } else {
        // No teams - check if subscribed
        if (coach.is_subscribed) {
          // Subscribed but no teams - go to onboarding to create first team
          router.push('/onboarding')
        } else {
          // Not subscribed and no teams - go to paywall
          router.push('/subscribe')
        }
      }
    } catch (error) {
      console.error('Error loading teams:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTeamChange = (newTeamId: string) => {
    setSelectedTeamId(newTeamId)
    router.push(`${pathname}?teamId=${newTeamId}`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const handleDeleteTeam = async () => {
    if (!selectedTeamId) return

    try {
      // Delete the team (cascade will handle team_players, notes, etc.)
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', selectedTeamId)

      if (error) throw error

      setShowDeleteTeamModal(false)
      
      // Reload teams and redirect to first available team
      await loadTeams()
    } catch (error) {
      console.error('Error deleting team:', error)
      alert('Failed to delete team')
    }
  }

  const selectedTeam = teams.find(t => t.id === selectedTeamId)

  // Grouped, not a flat list of seventeen.
  //
  // The first thing a new coach sees has to answer "what is this?", and the
  // answer is the loop: log what happened, get one thing to work on, find out
  // three weeks later whether it moved. That reads as the product only if it
  // sits at the top under its own heading. Everything else is a tool you reach
  // for when you need it, and headings say so without hiding anything.
  //
  // Playbooks is deliberately absent — the page still exists, it is just not a
  // destination. It duplicates what a priority does, without the evidence.
  const allNavGroups: Array<{
    label: string
    items: Array<{
      label: string
      href: string
      icon: any
      needs?: 'record' | 'decide' | 'own'
      // Coach-plan only. Game Day and the Pitch Counter deliberately are NOT
      // marked — a parent on the Personal plan keeps a scorebook and counts
      // pitches for their own kid. What they don't have is a team to run.
      needsTeam?: boolean
    }>
  }> = [
    {
      label: '',
      items: [
        // The whole loop is two destinations now. Home IS the plan board — it
        // was already rendering the same cards from the same data, so
        // "Dashboard" and "Priorities" were two URLs for one screen. CoachAI is
        // where you ask, and making an answer a plan is a button inside it.
        // Capture is the "+" in the header, because it happens from anywhere.
        //
        // Named for the outcome rather than the mechanism: a parent looking for
        // where the drills live is looking for skill development, not for a
        // ranked list.
        { label: 'Skill Development', href: '/dashboard', icon: Target },
        { label: 'CoachAI', href: '/dashboard/chat', icon: MessageSquare },
      ],
    },
    {
      label: 'Team',
      items: [
        { label: 'Roster', href: '/dashboard/roster', icon: Users },
        { label: 'Stats', href: '/dashboard/stats', icon: BarChart3 },
        { label: 'Notes', href: '/dashboard/notes', icon: StickyNote },
        { label: 'Staff', href: '/dashboard/team', icon: UsersRound, needs: 'own', needsTeam: true },
      ],
    },
    {
      label: 'Game Day',
      items: [
        { label: 'Game Day', href: '/dashboard/game', icon: Activity },
        { label: 'Pitch Counter', href: '/dashboard/count', icon: Timer },
        { label: 'Lineup Builder', href: '/dashboard/lineup', icon: Calendar, needs: 'decide', needsTeam: true },
        { label: 'Scouting', href: '/dashboard/scouting', icon: Search, needsTeam: true },
      ],
    },
    {
      label: 'Planning',
      items: [
        { label: 'Practice Plans', href: '/dashboard/practice', icon: ClipboardList, needs: 'decide', needsTeam: true },
        { label: 'Drill Library', href: '/dashboard/drills', icon: Bookmark },
      ],
    },
    {
      label: 'Account',
      items: [
        { label: 'AI Memory', href: '/dashboard/memory', icon: Brain, needs: 'decide' },
        { label: 'Profile', href: '/dashboard/profile', icon: UserCircle },
        { label: 'Settings', href: '/dashboard/settings', icon: Settings },
        { label: 'Help', href: '/dashboard/help', icon: HelpCircle },
      ],
    },
  ]

  // Drop what this role can never use, then drop any heading left empty by
  // that. A group header over nothing is worse than no header.
  const navGroups = allNavGroups
    .map(g => ({
      ...g,
      items: g.items.filter(i =>
        (!i.needs || allowed(i.needs)) &&
        (!i.needsTeam || teamFeatures)
      ),
    }))
    .filter(g => g.items.length > 0)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top Navigation */}
      <header className="bg-slate-900 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Left side - Hamburger + Logo */}
            <div className="flex items-center space-x-3">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Menu size={24} />
              </button>

              <Link href={`/dashboard?teamId=${selectedTeamId}`} className="flex items-center space-x-2">
                <Image 
                  src="/logo.png" 
                  alt="Bench Coach" 
                  width={140} 
                  height={40}
                  className="h-8 sm:h-9 w-auto"
                />
              </Link>
            </div>

            {/* Center - Team Selector (Desktop) */}
            <div className="hidden sm:flex items-center space-x-3">
              {teams.length > 0 && (
                <>
                  <select
                    value={selectedTeamId}
                    onChange={(e) => handleTeamChange(e.target.value)}
                    className="px-3 py-2 border border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-slate-800 text-white text-sm"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.season.name === 'Personal' 
                          ? `${team.name}`
                          : `${team.name} (${team.age_group})`
                        }
                      </option>
                    ))}
                  </select>
                  
                </>
              )}
            </div>

            {/* Right side — capture, then logout. The capture button lives
                here rather than in the desktop-only team block because logging
                something happens on a phone at a field. */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* The two things reached most often, at every breakpoint. On a
                  phone both used to cost a hamburger tap first. */}
              <Link
                href={`/dashboard/chat?teamId=${selectedTeamId}`}
                className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                aria-label="CoachAI"
                title="CoachAI"
              >
                <MessageSquare size={20} />
              </Link>
              <CaptureMenu teamId={selectedTeamId} canCreate={canCreate} canCreateTeams={teamFeatures} />
              <button
              onClick={handleLogout}
              className="flex items-center space-x-1 text-slate-300 hover:text-white transition-colors p-2"
            >
              <LogOut size={20} />
              <span className="text-sm hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Team Selector Bar */}
        <div className="sm:hidden border-t border-slate-700 px-4 py-2">
          {teams.length > 0 && (
            <div className="flex items-center space-x-2">
              <select
                value={selectedTeamId}
                onChange={(e) => handleTeamChange(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-slate-800 text-white text-sm"
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.season.name === 'Personal' 
                      ? `${team.name}`
                      : `${team.name} (${team.age_group})`
                    }
                  </option>
                ))}
              </select>
              
              {canCreate && teamFeatures && (
                <Link
                  href="/dashboard/new-team"
                  className="flex items-center justify-center p-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Plus size={20} />
                </Link>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 w-72 bg-white shadow-xl z-50 lg:hidden overflow-y-auto">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <Image 
                  src="/logo.png" 
                  alt="Bench Coach" 
                  width={120} 
                  height={35}
                  className="h-8 w-auto"
                />
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  <X size={24} />
                </button>
              </div>
            </div>
            
            {/* Mobile New Buttons */}
            {canCreate && (
              <div className="p-4 border-b border-gray-200 space-y-2">
                {teamFeatures && (
                  <Link
                    href="/dashboard/new-team"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center space-x-3 px-4 py-3 bg-red-50 text-red-700 rounded-lg"
                  >
                    <Users size={20} />
                    <span className="font-medium">New Team</span>
                  </Link>
                )}
                <Link
                  href="/dashboard/new-player"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center space-x-3 px-4 py-3 bg-green-50 text-green-700 rounded-lg"
                >
                  <UserPlus size={20} />
                  <span className="font-medium">New Player</span>
                </Link>
              </div>
            )}

            {/* Navigation Links */}
            <nav className="p-4 space-y-4">
              {navGroups.map((group, gi) => (
                <div key={group.label || `g${gi}`} className="space-y-1">
                  {group.label && (
                    <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {group.label}
                    </div>
                  )}
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = pathname === item.href
                    return (
                      <Link
                        key={item.href}
                        href={`${item.href}?teamId=${selectedTeamId}`}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                          isActive
                            ? 'bg-red-50 text-red-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <Icon size={20} />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              ))}
            </nav>

            {/* Delete Team - Bottom of drawer */}
            {canCreate && selectedTeam && (
              <div className="p-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setShowDeleteTeamModal(true)
                  }}
                  className="flex items-center space-x-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg w-full"
                >
                  <Trash2 size={20} />
                  <span>Delete Current Team</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="flex">
          {/* Desktop Sidebar Navigation */}
          <aside className="hidden lg:block w-64 flex-shrink-0 pr-8">
            <nav className="space-y-4 sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4">
              {navGroups.map((group, gi) => (
                <div key={group.label || `g${gi}`} className="space-y-1">
                  {group.label && (
                    <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {group.label}
                    </div>
                  )}
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = pathname === item.href
                    return (
                      <Link
                        key={item.href}
                        href={`${item.href}?teamId=${selectedTeamId}`}
                        className={`flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors ${
                          isActive
                            ? 'bg-red-50 text-red-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <Icon size={20} />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              ))}
              
              {/* Delete Team - Desktop */}
              {canCreate && selectedTeam && (
                <button
                  onClick={() => setShowDeleteTeamModal(true)}
                  className="flex items-center space-x-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg w-full mt-4"
                >
                  <Trash2 size={20} />
                  <span>Delete Team</span>
                </button>
              )}
            </nav>
          </aside>

          {/* Main Content */}
          {/* Where an invited coach stands. Owners see nothing — they don't need
          telling, and a permanent banner on your own team is noise. */}
      {roleLabel && role !== 'owner' && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
          <p className="max-w-7xl mx-auto text-xs text-blue-900">{roleLabel}</p>
        </div>
      )}

      <main className="flex-1 min-w-0">
            {children}
          </main>
        </div>
      </div>

      {/* Delete Team Confirmation Modal */}
      {showDeleteTeamModal && selectedTeam && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Team</h3>
            <p className="text-gray-600 mb-2">
              Are you sure you want to delete <strong>{selectedTeam.name}</strong>?
            </p>
            <p className="text-red-600 text-sm mb-6">
              This will permanently delete the team and all its data including roster, notes, practice plans, and chat history.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteTeamModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTeam}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete Team
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Wrap in Suspense to handle useSearchParams
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <DashboardContent>{children}</DashboardContent>
    </Suspense>
  )
}
