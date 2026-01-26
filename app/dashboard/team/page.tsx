'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { 
  Users, Plus, Copy, Check, Trash2, Shield, Eye, Pencil, 
  Crown, Link2, RefreshCw, Clock, UserMinus, ChevronDown
} from 'lucide-react'

interface TeamMember {
  id: string
  name: string
  role: string
  user_id: string
  joined_at: string
}

interface TeamOwner {
  id: string
  name: string
  user_id: string
}

interface Invitation {
  id: string
  role: string
  token: string
  expires_at: string
  max_uses: number
  use_count: number
  created_at: string
}

function TeamMembersContent() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [owner, setOwner] = useState<TeamOwner | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentCoachId, setCurrentCoachId] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(true)
  
  // Modal states
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteRole, setInviteRole] = useState('contributor')
  const [inviteExpires, setInviteExpires] = useState('7')
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  
  // Member management
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [memberToEdit, setMemberToEdit] = useState<TeamMember | null>(null)
  const [newRole, setNewRole] = useState('')
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null)
  
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadData()
    }
  }, [teamId])

  const loadData = async () => {
    setLoading(true)
    try {
      // Get current user client-side
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        console.error('No user found')
        setLoading(false)
        return
      }

      // Get coach info for current user
      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single()

      // Save user credentials for API calls
      setCurrentUserId(user.id)
      setCurrentCoachId(coach?.id || null)

      // Get team info to check ownership
      const { data: team } = await supabase
        .from('teams')
        .select('id, name, coach_id')
        .eq('id', teamId)
        .single()

      // Determine if current user is owner
      const isOwner = team?.coach_id === coach?.id

      // Set team name
      setTeamName(team?.name || '')

      // Get owner coach info
      if (team?.coach_id) {
        const { data: ownerCoach } = await supabase
          .from('coaches')
          .select('id, display_name, user_id')
          .eq('id', team.coach_id)
          .single()
        
        setOwner(ownerCoach ? {
          id: ownerCoach.id,
          name: ownerCoach.display_name || 'Team Owner',
          user_id: ownerCoach.user_id
        } : null)
      }

      // Set current user role
      if (isOwner) {
        setCurrentUserRole('owner')
      } else {
        // Check team_members table for role
        const { data: membership } = await supabase
          .from('team_members')
          .select('role')
          .eq('team_id', teamId)
          .eq('user_id', user.id)
          .single()
        
        setCurrentUserRole(membership?.role || null)
      }

      // Load team members
      const { data: membersData } = await supabase
        .from('team_members')
        .select('id, role, joined_at, user_id')
        .eq('team_id', teamId)
        .order('joined_at', { ascending: true })

      // Get names for members
      const membersWithNames = await Promise.all(
        (membersData || []).map(async (member) => {
          const { data: memberCoach } = await supabase
            .from('coaches')
            .select('display_name')
            .eq('user_id', member.user_id)
            .single()
          
          return {
            ...member,
            name: memberCoach?.display_name || 'Unknown'
          }
        })
      )
      
      setMembers(membersWithNames)

      // Load invitations
      const invitesRes = await fetch(`/api/team/invite?teamId=${teamId}`)
      const invitesData = await invitesRes.json()
      
      if (invitesRes.ok) {
        setInvitations(invitesData.invitations || [])
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateInvite = async () => {
    if (!currentUserId || !currentCoachId) {
      alert('Unable to verify your identity. Please refresh the page.')
      return
    }

    setCreatingInvite(true)
    setNewInviteUrl(null)
    
    try {
      const response = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          role: inviteRole,
          expiresInDays: parseInt(inviteExpires),
          maxUses: 10, // Allow multiple uses
          userId: currentUserId,
          coachId: currentCoachId,
        }),
      })

      const data = await response.json()
      
      if (response.ok) {
        setNewInviteUrl(data.inviteUrl)
        loadData() // Refresh invitations list
      } else {
        alert(data.error || 'Failed to create invitation')
      }
    } catch (error) {
      console.error('Error creating invite:', error)
      alert('Failed to create invitation')
    } finally {
      setCreatingInvite(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevokeInvite = async (invitationId: string) => {
    try {
      const response = await fetch(`/api/team/invite?id=${invitationId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadData()
      } else {
        alert('Failed to revoke invitation')
      }
    } catch (error) {
      console.error('Error revoking invite:', error)
    }
  }

  const openRoleModal = (member: TeamMember) => {
    setMemberToEdit(member)
    setNewRole(member.role)
    setShowRoleModal(true)
  }

  const handleUpdateRole = async () => {
    if (!memberToEdit) return

    try {
      const response = await fetch('/api/team/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: memberToEdit.id,
          role: newRole,
        }),
      })

      if (response.ok) {
        setShowRoleModal(false)
        setMemberToEdit(null)
        loadData()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to update role')
      }
    } catch (error) {
      console.error('Error updating role:', error)
    }
  }

  const openRemoveModal = (member: TeamMember) => {
    setMemberToRemove(member)
    setShowRemoveModal(true)
  }

  const handleRemoveMember = async () => {
    if (!memberToRemove) return

    try {
      const response = await fetch(`/api/team/members?id=${memberToRemove.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setShowRemoveModal(false)
        setMemberToRemove(null)
        loadData()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to remove member')
      }
    } catch (error) {
      console.error('Error removing member:', error)
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="text-yellow-600" size={18} />
      case 'admin':
        return <Shield className="text-purple-600" size={18} />
      case 'contributor':
        return <Pencil className="text-blue-600" size={18} />
      default:
        return <Eye className="text-gray-600" size={18} />
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-yellow-100 text-yellow-700'
      case 'admin':
        return 'bg-purple-100 text-purple-700'
      case 'contributor':
        return 'bg-blue-100 text-blue-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const canManageMembers = currentUserRole === 'owner' || currentUserRole === 'admin'
  const canInvite = currentUserRole === 'owner' || currentUserRole === 'admin'
  const isOwner = currentUserRole === 'owner'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
            <Users className="text-red-600" size={28} />
            <span>Team Members</span>
          </h2>
          <p className="text-gray-600 mt-1">
            Manage who has access to {teamName}
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => {
              setNewInviteUrl(null)
              setShowInviteModal(true)
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Plus size={20} />
            <span>Invite Coach</span>
          </button>
        )}
      </div>

      {/* Owner Card */}
      {owner && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Team Owner</h3>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                  <Crown className="text-yellow-600" size={20} />
                </div>
                <div>
                  <div className="font-medium text-gray-900">{owner.name}</div>
                  <div className="text-sm text-gray-500">Owner • Full access</div>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${getRoleBadgeColor('owner')}`}>
                Owner
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Team Members */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Coaches ({members.length})
          </h3>
        </div>
        
        {members.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-600 mb-4">No other coaches yet</p>
            {canInvite && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="text-red-600 hover:text-red-700 font-medium"
              >
                Invite your first assistant coach
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {members.map((member) => (
              <div key={member.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    member.role === 'admin' ? 'bg-purple-100' :
                    member.role === 'contributor' ? 'bg-blue-100' : 'bg-gray-100'
                  }`}>
                    {getRoleIcon(member.role)}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{member.name}</div>
                    <div className="text-sm text-gray-500">
                      Joined {new Date(member.joined_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getRoleBadgeColor(member.role)}`}>
                    {member.role}
                  </span>
                  {canManageMembers && (
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => openRoleModal(member)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Change role"
                      >
                        <ChevronDown size={18} />
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => openRemoveModal(member)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove member"
                        >
                          <UserMinus size={18} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Invitations */}
      {canInvite && invitations.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Active Invite Links</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {invitations.map((invite) => (
              <div key={invite.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Link2 className="text-gray-400" size={20} />
                  <div>
                    <div className="font-medium text-gray-900 capitalize">
                      {invite.role} Invite
                    </div>
                    <div className="text-sm text-gray-500 flex items-center space-x-2">
                      <Clock size={14} />
                      <span>Expires {new Date(invite.expires_at).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{invite.use_count}/{invite.max_uses} uses</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => copyToClipboard(`${window.location.origin}/invite/${invite.token}`)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Copy link"
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    onClick={() => handleRevokeInvite(invite.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Revoke"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Invite a Coach</h3>
            
            {newInviteUrl ? (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-800 font-medium mb-2">Invite link created!</p>
                  <p className="text-sm text-green-700">Share this link with the coach you want to invite:</p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={newInviteUrl}
                    readOnly
                    className="flex-1 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(newInviteUrl)}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                      copied 
                        ? 'bg-green-600 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <button
                  onClick={() => {
                    setShowInviteModal(false)
                    setNewInviteUrl(null)
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="viewer">Viewer - Can view only</option>
                    <option value="contributor">Contributor - Can add notes &amp; use chat</option>
                    <option value="admin">Admin - Full access except delete team</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Link expires in
                  </label>
                  <select
                    value={inviteExpires}
                    onChange={(e) => setInviteExpires(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="1">1 day</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                  </select>
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateInvite}
                    disabled={creatingInvite}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creatingInvite ? 'Creating...' : 'Create Link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Change Role Modal */}
      {showRoleModal && memberToEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Change Role for {memberToEdit.name}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Role
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowRoleModal(false)
                    setMemberToEdit(null)
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateRole}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Update Role
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Member Modal */}
      {showRemoveModal && memberToRemove && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Remove Member</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to remove <strong>{memberToRemove.name}</strong> from the team? They will lose access immediately.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowRemoveModal(false)
                  setMemberToRemove(null)
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveMember}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TeamMembersPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <TeamMembersContent />
    </Suspense>
  )
}
