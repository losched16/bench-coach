'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { User, Lock, CreditCard, Shield, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react'

interface CoachProfile {
  id: string
  user_id: string
  display_name?: string
  is_subscribed?: boolean
  subscription_tier?: string
  stripe_customer_id?: string
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<CoachProfile | null>(null)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [billingLoading, setBillingLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  // Form states
  const [displayName, setDisplayName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  
  // Membership info
  const [ownedTeamsCount, setOwnedTeamsCount] = useState(0)
  const [memberTeamsCount, setMemberTeamsCount] = useState(0)
  
  const router = useRouter()
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }
      setUser(user)

      // Get coach profile with subscription info
      const { data: coach } = await supabase
        .from('coaches')
        .select('id, user_id, display_name, is_subscribed, subscription_tier, stripe_customer_id')
        .eq('user_id', user.id)
        .single()

      if (coach) {
        setProfile(coach)
        setDisplayName(coach.display_name || '')
      }

      // Count owned teams
      const { count: owned } = await supabase
        .from('teams')
        .select('*', { count: 'exact', head: true })
        .eq('coach_id', coach?.id)

      setOwnedTeamsCount(owned || 0)

      // Count member teams
      const { count: member } = await supabase
        .from('team_members')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      setMemberTeamsCount(member || 0)

    } catch (error) {
      console.error('Error loading profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const { error } = await supabase
        .from('coaches')
        .update({ display_name: displayName })
        .eq('id', profile?.id)

      if (error) throw error

      setMessage({ type: 'success', text: 'Profile updated successfully!' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to update profile' })
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' })
      setSaving(false)
      return
    }

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      setSaving(false)
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      setMessage({ type: 'success', text: 'Password changed successfully!' })
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to change password' })
    } finally {
      setSaving(false)
    }
  }

  const handleUpgrade = async () => {
    setBillingLoading(true)
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: user?.id,
          returnUrl: window.location.origin 
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
      setBillingLoading(false)
    }
  }

  const handleManageBilling = async () => {
    setBillingLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to open billing portal')
      }

      // Redirect to Stripe Billing Portal
      window.location.href = data.url
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
      setBillingLoading(false)
    }
  }

  const getMembershipLevel = () => {
    if (profile?.is_subscribed) {
      return { 
        level: 'Pro', 
        color: 'bg-green-100 text-green-700', 
        description: 'Full access to all features',
        badge: '✨'
      }
    } else if (ownedTeamsCount > 0) {
      return { 
        level: 'Owner (Legacy)', 
        color: 'bg-blue-100 text-blue-700', 
        description: 'You have full access - grandfathered in',
        badge: '👑'
      }
    } else if (memberTeamsCount > 0) {
      return { 
        level: 'Team Member', 
        color: 'bg-gray-100 text-gray-700', 
        description: 'You have access to teams you\'ve been invited to',
        badge: '👥'
      }
    }
    return { 
      level: 'Free', 
      color: 'bg-gray-100 text-gray-700', 
      description: 'Upgrade to create your own teams',
      badge: '🆓'
    }
  }

  const membership = getMembershipLevel()
  const canUpgrade = !profile?.is_subscribed && ownedTeamsCount === 0
  const hasSubscription = profile?.stripe_customer_id && profile?.is_subscribed

  if (loading) {
    return <div className="text-gray-600">Loading profile...</div>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile Settings</h1>
        <p className="text-gray-600 mt-1">Manage your account and subscription</p>
      </div>

      {/* Message */}
      {message && (
        <div className={`flex items-center space-x-2 p-4 rounded-lg ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Membership Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Shield className="text-gray-600" size={24} />
          <h2 className="text-lg font-semibold text-gray-900">Membership</h2>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-sm font-medium ${membership.color}`}>
                <span>{membership.badge}</span>
                <span>{membership.level}</span>
              </span>
              <p className="text-sm text-gray-600 mt-1">{membership.description}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
            <div>
              <div className="text-2xl font-bold text-gray-900">{ownedTeamsCount}</div>
              <div className="text-sm text-gray-600">Teams Owned</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{memberTeamsCount}</div>
              <div className="text-sm text-gray-600">Team Memberships</div>
            </div>
          </div>

          {canUpgrade && (
            <div className="pt-4 border-t border-gray-100">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-gray-900 mb-1">Upgrade to Pro</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Get full access to create teams, players, practice plans, and more.
                </p>
                <ul className="text-sm text-gray-600 space-y-1 mb-4">
                  <li>✓ Create unlimited teams</li>
                  <li>✓ Add unlimited players</li>
                  <li>✓ AI-powered practice plans</li>
                  <li>✓ Invite assistant coaches (free for them)</li>
                  <li>✓ 14-day free trial</li>
                </ul>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-2xl font-bold text-gray-900">$10</span>
                    <span className="text-gray-600">/month</span>
                  </div>
                  <button
                    onClick={handleUpgrade}
                    disabled={billingLoading}
                    className="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-colors disabled:opacity-50 flex items-center space-x-2"
                  >
                    {billingLoading ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <>
                        <span>Start Free Trial</span>
                        <ExternalLink size={16} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profile Info */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <User className="text-gray-600" size={24} />
          <h2 className="text-lg font-semibold text-gray-900">Profile Information</h2>
        </div>
        
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
            />
            <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="Coach Smith"
            />
          </div>
          
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Lock className="text-gray-600" size={24} />
          <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
        </div>
        
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          
          <button
            type="submit"
            disabled={saving || !newPassword || !confirmPassword}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* Billing */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <CreditCard className="text-gray-600" size={24} />
          <h2 className="text-lg font-semibold text-gray-900">Billing</h2>
        </div>
        
        {hasSubscription ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
              <div>
                <p className="font-medium text-green-700">Active Subscription</p>
                <p className="text-sm text-green-600">Bench Coach Pro - $10/month</p>
              </div>
              <Check className="text-green-600" size={24} />
            </div>
            <button
              onClick={handleManageBilling}
              disabled={billingLoading}
              className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {billingLoading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  <span>Manage Billing</span>
                  <ExternalLink size={16} />
                </>
              )}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Update payment method, view invoices, or cancel subscription
            </p>
          </div>
        ) : canUpgrade ? (
          <div className="text-center py-4 text-gray-500">
            <p>Upgrade to Pro to access billing management</p>
          </div>
        ) : (
          <div className="text-center py-4 text-gray-500">
            <p>No active subscription</p>
            <p className="text-sm mt-1">You have legacy owner access</p>
          </div>
        )}
      </div>
    </div>
  )
}
