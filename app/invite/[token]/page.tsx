'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Image from 'next/image'
import Link from 'next/link'
import { Users, Shield, Eye, Pencil, Loader2, CheckCircle, XCircle } from 'lucide-react'

interface InvitationInfo {
  id: string
  role: string
  teamName: string
  teamAgeGroup: string
  ownerName: string
}

export default function InviteAcceptPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const supabase = createSupabaseComponentClient()

  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [success, setSuccess] = useState(false)
  const [joinedTeamId, setJoinedTeamId] = useState<string | null>(null)
  const [autoAccepting, setAutoAccepting] = useState(false)

  useEffect(() => {
    // Store the invite token so we can return after auth
    sessionStorage.setItem('pendingInviteToken', token)
    
    checkAuthAndLoad()
  }, [token])

  const checkAuthAndLoad = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
    await loadInvitation()
    
    // If user just came back from signup/login, auto-accept
    const pendingToken = sessionStorage.getItem('pendingInviteToken')
    if (user && pendingToken === token) {
      // Small delay to let the UI render first
      setAutoAccepting(true)
      setTimeout(() => {
        handleAcceptInternal(user.id)
      }, 500)
    }
  }

  const loadInvitation = async () => {
    try {
      const response = await fetch(`/api/team/invite/accept?token=${token}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid invitation')
        return
      }

      setInvitation(data.invitation)
    } catch (err) {
      setError('Failed to load invitation')
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptInternal = async (userId: string) => {
    setAccepting(true)
    try {
      const response = await fetch('/api/team/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token,
          userId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to accept invitation')
        setAutoAccepting(false)
        return
      }

      // Clear the pending invite
      sessionStorage.removeItem('pendingInviteToken')
      
      setSuccess(true)
      setJoinedTeamId(data.teamId)

      // Redirect to dashboard after a moment
      setTimeout(() => {
        router.push(`/dashboard?teamId=${data.teamId}`)
      }, 2000)

    } catch (err) {
      setError('Failed to accept invitation')
      setAutoAccepting(false)
    } finally {
      setAccepting(false)
    }
  }

  const handleAccept = async () => {
    if (!user) {
      // Redirect to signup (more likely for new users) with return URL
      router.push(`/auth/signup?redirect=/invite/${token}`)
      return
    }

    await handleAcceptInternal(user.id)
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield className="text-purple-600" size={24} />
      case 'contributor':
        return <Pencil className="text-blue-600" size={24} />
      default:
        return <Eye className="text-gray-600" size={24} />
    }
  }

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Full access to manage team, players, and invite others'
      case 'contributor':
        return 'Can add notes, mark progress, and use chat'
      default:
        return 'Can view team info, roster, and plans'
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-700 border-purple-200'
      case 'contributor':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
      {/* Header */}
      <header className="bg-[#0f172a] shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/">
            <Image
              src="/logo.png"
              alt="Bench Coach"
              width={160}
              height={45}
              className="h-10 w-auto"
              priority
            />
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="animate-spin mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600">Loading invitation...</p>
            </div>
          ) : error && !success ? (
            <div className="p-12 text-center">
              <XCircle className="mx-auto text-red-500 mb-4" size={48} />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid Invitation</h2>
              <p className="text-gray-600 mb-6">{error}</p>
              <Link
                href="/"
                className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Go to Home
              </Link>
            </div>
          ) : success ? (
            <div className="p-12 text-center">
              <CheckCircle className="mx-auto text-green-500 mb-4" size={48} />
              <h2 className="text-xl font-bold text-gray-900 mb-2">You&apos;re In!</h2>
              <p className="text-gray-600 mb-2">
                You&apos;ve successfully joined <strong>{invitation?.teamName}</strong>
              </p>
              <p className="text-sm text-gray-500 mb-6">Redirecting to dashboard...</p>
              <Link
                href={`/dashboard?teamId=${joinedTeamId}`}
                className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Go to Dashboard
              </Link>
            </div>
          ) : invitation ? (
            <>
              {/* Invitation Header */}
              <div className="bg-[#0f172a] px-6 py-8 text-center">
                <Users className="mx-auto text-white mb-3" size={40} />
                <h1 className="text-xl font-bold text-white mb-1">Team Invitation</h1>
                <p className="text-slate-300">You&apos;ve been invited to join a team</p>
              </div>

              {/* Invitation Details */}
              <div className="p-6 space-y-6">
                {/* Team Info */}
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-gray-900">{invitation.teamName}</h2>
                  {invitation.teamAgeGroup && (
                    <p className="text-gray-600">{invitation.teamAgeGroup}</p>
                  )}
                  <p className="text-sm text-gray-500 mt-1">
                    Invited by {invitation.ownerName}
                  </p>
                </div>

                {/* Role Badge */}
                <div className="flex justify-center">
                  <div className={`inline-flex items-center space-x-2 px-4 py-2 rounded-lg border ${getRoleColor(invitation.role)}`}>
                    {getRoleIcon(invitation.role)}
                    <div className="text-left">
                      <div className="font-semibold capitalize">{invitation.role}</div>
                      <div className="text-xs opacity-75">{getRoleDescription(invitation.role)}</div>
                    </div>
                  </div>
                </div>

                {/* Permission Details */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-2">What you&apos;ll be able to do:</h3>
                  <ul className="space-y-1 text-sm text-gray-600">
                    <li className="flex items-center space-x-2">
                      <CheckCircle size={16} className="text-green-500" />
                      <span>View team roster and player info</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle size={16} className="text-green-500" />
                      <span>Access practice plans and playbooks</span>
                    </li>
                    {(invitation.role === 'contributor' || invitation.role === 'admin') && (
                      <>
                        <li className="flex items-center space-x-2">
                          <CheckCircle size={16} className="text-green-500" />
                          <span>Add notes and mark playbook progress</span>
                        </li>
                        <li className="flex items-center space-x-2">
                          <CheckCircle size={16} className="text-green-500" />
                          <span>Use AI coaching chat</span>
                        </li>
                      </>
                    )}
                    {invitation.role === 'admin' && (
                      <>
                        <li className="flex items-center space-x-2">
                          <CheckCircle size={16} className="text-green-500" />
                          <span>Manage roster and team settings</span>
                        </li>
                        <li className="flex items-center space-x-2">
                          <CheckCircle size={16} className="text-green-500" />
                          <span>Invite other coaches</span>
                        </li>
                      </>
                    )}
                  </ul>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                  {user ? (
                    <button
                      onClick={handleAccept}
                      disabled={accepting}
                      className="w-full px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      {accepting ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          <span>Joining...</span>
                        </>
                      ) : (
                        <span>Accept Invitation</span>
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleAccept}
                        className="w-full px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Sign In to Accept
                      </button>
                      <p className="text-center text-sm text-gray-500">
                        Don&apos;t have an account?{' '}
                        <Link href={`/auth/signup?redirect=/invite/${token}`} className="text-red-600 hover:text-red-700">
                          Sign up
                        </Link>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0f172a] mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-slate-400 text-sm">
            © {new Date().getFullYear()} Bench Coach. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
