'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Link from 'next/link'
import Image from 'next/image'
import { MessageSquare, Users, StickyNote, ClipboardList, Home, LogOut, Plus, UserPlus, Trash2, Settings, Bookmark, Library, BookOpen, HelpCircle, Brain, UsersRound, UserCircle } from 'lucide-react'

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
  const [canCreate, setCanCreate] = useState(false) // Can user create teams/players?
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
      <header className="bg-[#0f172a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Image 
                src="/logo.png" 
                alt="Bench Coach" 
                width={160} 
                height={45}
                className="h-10 w-auto"
                priority
              />
              
              {/* Team Selector */}
              {teams.length > 0 && (
                <div className="flex items-center space-x-2">
                  <select
                    value={selectedTeamId}
                    onChange={(e) => handleTeamChange(e.target.value)}
                    className="px-4 py-2 border border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-slate-800 text-white text-sm"
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
                  
                  {/* New Button with Dropdown - Only for subscribers/owners */}
                  {canCreate ? (
                    <div className="relative">
                      <button
                        onClick={() => setShowNewMenu(!showNewMenu)}
                        className="flex items-center space-x-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                      >
                        <Plus size={16} />
                        <span>New</span>
                      </button>
                      
                      {showNewMenu && (
                        <>
                          {/* Backdrop to close menu */}
                          <div 
                            className="fixed inset-0 z-10" 
                            onClick={() => setShowNewMenu(false)}
                          />
                          
                          {/* Dropdown Menu */}
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
                                  <div className="text-sm text-gray-500">Create a new team & season</div>
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
                                  <div className="text-sm text-gray-500">Add a kid for personal training</div>
                                </div>
                              </Link>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <Link
                      href="/dashboard/profile"
                      className="flex items-center space-x-1 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-colors text-sm font-medium"
                    >
                      <span>⭐</span>
                      <span>Upgrade</span>
                    </Link>
                  )}

                  {/* Delete Team Button - Only for owners */}
                  {canCreate && (
                    <button
                      onClick={() => setShowDeleteTeamModal(true)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Delete current team"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center space-x-2 text-slate-300 hover:text-white transition-colors"
            >
              <LogOut size={20} />
              <span className="text-sm">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex space-x-8">
          {/* Sidebar Navigation */}
          <aside className="w-64 flex-shrink-0">
            <nav className="space-y-1">
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
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1">
            {children}
          </main>
        </div>
      </div>

      {/* Delete Team Confirmation Modal */}
      {showDeleteTeamModal && selectedTeam && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
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
