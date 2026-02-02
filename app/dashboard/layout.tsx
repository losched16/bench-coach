'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Link from 'next/link'
import Image from 'next/image'
import { MessageSquare, Users, StickyNote, ClipboardList, Home, LogOut, Plus, UserPlus, Trash2, Settings, Bookmark, Library, BookOpen, HelpCircle, Brain, UsersRound, UserCircle, Menu, X } from 'lucide-react'
import { MessageSquare, ClipboardList, Users, FileText, Calendar } from 'lucide-react'


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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = createSupabaseComponentClient()

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

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', icon: Home },
    { label: 'Chat', href: '/dashboard/chat', icon: MessageSquare },
    { label: 'Roster', href: '/dashboard/roster', icon: Users },
    { label: 'Notes', href: '/dashboard/notes', icon: StickyNote },
    { label: 'Practice Plans', href: '/dashboard/practice', icon: ClipboardList },
// Then in your navigation links array, add this entry:
{
  label: 'Game Day',
  icon: Calendar,
  href: `/dashboard/lineup?teamId=${selectedTeamId}`,
}
    { label: 'Practice Library', href: '/dashboard/templates', icon: Library },
    { label: 'Playbooks', href: '/dashboard/playbooks', icon: BookOpen },
    { label: 'Saved Drills', href: '/dashboard/drills', icon: Bookmark },
    { label: 'AI Memory', href: '/dashboard/memory', icon: Brain },
    { label: 'Team Members', href: '/dashboard/team', icon: UsersRound },
    { label: 'Profile', href: '/dashboard/profile', icon: UserCircle },
    { label: 'Help', href: '/dashboard/help', icon: HelpCircle },
    { label: 'Settings', href: '/dashboard/settings', icon: Settings },
  ]

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0f172a] sticky top-0 z-40">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* Left side - Hamburger and Logo */}
            <div className="flex items-center space-x-3">
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
              
              <Image 
                src="/logo.png" 
                alt="Bench Coach" 
                width={140} 
                height={40}
                className="h-8 sm:h-10 w-auto"
                priority
              />
            </div>

            {/* Center - Team Selector (hidden on small screens, shown in mobile bar) */}
            <div className="hidden sm:flex items-center space-x-2">
              {teams.length > 0 && (
                <>
                  <select
                    value={selectedTeamId}
                    onChange={(e) => handleTeamChange(e.target.value)}
                    className="px-3 py-1.5 border border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-slate-800 text-white text-sm max-w-[220px]"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.season.name === 'Personal' 
                          ? `${team.name} (Personal)`
                          : `${team.season.name} - ${team.name} (${team.age_group})`
                        }
                      </option>
                    ))}
                  </select>
                  
                  {/* New Button - Desktop only */}
                  {canCreate && (
                    <div className="relative hidden md:block">
                      <button
                        onClick={() => setShowNewMenu(!showNewMenu)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                      >
                        <Plus size={16} />
                        <span>New</span>
                      </button>
                      
                      {showNewMenu && (
                        <>
                          <div 
                            className="fixed inset-0 z-10" 
                            onClick={() => setShowNewMenu(false)}
                          />
                          <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                            <div className="p-2">
                              <Link
                                href="/dashboard/new-team"
                                onClick={() => setShowNewMenu(false)}
                                className="flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                <Users size={20} className="text-red-600" />
                                <div>
                                  <div className="font-medium text-gray-900">New Team</div>
                                  <div className="text-sm text-gray-500">Create a new team</div>
                                </div>
                              </Link>
                              <Link
                                href="/dashboard/new-player"
                                onClick={() => setShowNewMenu(false)}
                                className="flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                <UserPlus size={20} className="text-green-600" />
                                <div>
                                  <div className="font-medium text-gray-900">New Player</div>
                                  <div className="text-sm text-gray-500">Personal training</div>
                                </div>
                              </Link>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right side - Logout */}
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1 text-slate-300 hover:text-white transition-colors p-2"
            >
              <LogOut size={20} />
              <span className="text-sm hidden sm:inline">Logout</span>
            </button>
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
              
              {canCreate && (
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
                <Link
                  href="/dashboard/new-team"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center space-x-3 px-4 py-3 bg-red-50 text-red-700 rounded-lg"
                >
                  <Users size={20} />
                  <span className="font-medium">New Team</span>
                </Link>
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
            <nav className="p-4 space-y-1">
              {navItems.map((item) => {
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
            <nav className="space-y-1 sticky top-24">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={`${item.href}?teamId=${selectedTeamId}`}
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
