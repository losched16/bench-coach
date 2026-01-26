'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Image from 'next/image'
import { Check, Loader2, Shield } from 'lucide-react'

function SubscribeContent() {
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createSupabaseComponentClient()
  
  // Check if coming back from checkout
  const upgradeStatus = searchParams.get('upgrade')

  useEffect(() => {
    checkAccess()
  }, [])

  const checkAccess = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/auth/login')
      return
    }

    setUser(user)

    // Check if coming back from successful checkout
    const upgradeStatus = searchParams.get('upgrade')
    if (upgradeStatus === 'success') {
      // Poll for subscription status (webhook might take a moment)
      await pollForSubscription(user.id)
      return
    }

    // Check if user already has access (subscribed or has team memberships)
    const { data: coach } = await supabase
      .from('coaches')
      .select('id, is_subscribed')
      .eq('user_id', user.id)
      .single()

    if (coach?.is_subscribed) {
      // Already subscribed, go to onboarding or dashboard
      router.push('/onboarding')
      return
    }

    // Check if user has team memberships (invited users)
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .limit(1)

    if (memberships && memberships.length > 0) {
      // Has team access via invite, go to dashboard
      router.push(`/dashboard?teamId=${memberships[0].team_id}`)
      return
    }

    // Check if user owns any teams (legacy users)
    if (coach) {
      const { data: ownedTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('coach_id', coach.id)
        .limit(1)

      if (ownedTeams && ownedTeams.length > 0) {
        // Legacy owner, go to dashboard
        router.push('/dashboard')
        return
      }
    }

    setLoading(false)
  }

  const pollForSubscription = async (userId: string) => {
    // Poll up to 15 times (30 seconds total)
    for (let i = 0; i < 15; i++) {
      const { data: coach } = await supabase
        .from('coaches')
        .select('is_subscribed')
        .eq('user_id', userId)
        .single()

      if (coach?.is_subscribed) {
        router.push('/onboarding')
        return
      }

      // Wait 2 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // After 30 seconds, redirect to onboarding anyway (webhook should have processed)
    // The onboarding page will handle if subscription isn't active
    router.push('/onboarding')
  }

  const handleCheckout = async () => {
    setCheckoutLoading(true)
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

      window.location.href = data.url
    } catch (error: any) {
      console.error('Checkout error:', error)
      setCheckoutLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
        <Loader2 className="animate-spin text-orange-500 mb-4" size={48} />
        <p className="text-gray-600">
          {upgradeStatus === 'success' ? 'Processing your subscription...' : 'Setting up your account...'}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-[#0f172a] py-6">
        <div className="flex justify-center">
          <Image 
            src="/logo.png" 
            alt="Bench Coach" 
            width={200} 
            height={60}
            className="h-12 w-auto"
            priority
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 px-4 py-12">
        <div className="max-w-lg w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full flex items-center justify-center">
                <Shield className="text-white" size={32} />
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Start Your Free Trial
              </h1>
              <p className="text-gray-600">
                Get full access to Bench Coach for 14 days, free.
              </p>
            </div>

            {/* Features */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <ul className="space-y-3">
                <li className="flex items-center space-x-3">
                  <Check className="text-green-500 flex-shrink-0" size={20} />
                  <span className="text-gray-700">Create unlimited teams</span>
                </li>
                <li className="flex items-center space-x-3">
                  <Check className="text-green-500 flex-shrink-0" size={20} />
                  <span className="text-gray-700">Add unlimited players</span>
                </li>
                <li className="flex items-center space-x-3">
                  <Check className="text-green-500 flex-shrink-0" size={20} />
                  <span className="text-gray-700">AI-powered practice plans</span>
                </li>
                <li className="flex items-center space-x-3">
                  <Check className="text-green-500 flex-shrink-0" size={20} />
                  <span className="text-gray-700">Invite assistant coaches (free for them)</span>
                </li>
                <li className="flex items-center space-x-3">
                  <Check className="text-green-500 flex-shrink-0" size={20} />
                  <span className="text-gray-700">Player notes & progress tracking</span>
                </li>
              </ul>
            </div>

            {/* Pricing */}
            <div className="text-center mb-6">
              <div className="text-gray-500 text-sm mb-1">After your trial</div>
              <div>
                <span className="text-4xl font-bold text-gray-900">$10</span>
                <span className="text-gray-600">/month</span>
              </div>
              <div className="text-sm text-gray-500 mt-1">Cancel anytime</div>
            </div>

            {/* CTA */}
            <button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-lg hover:from-amber-600 hover:to-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {checkoutLoading ? (
                <Loader2 className="animate-spin" size={24} />
              ) : (
                <span>Start 14-Day Free Trial</span>
              )}
            </button>

            {/* Fine print */}
            <p className="text-xs text-gray-500 text-center mt-4">
              You won&apos;t be charged until your trial ends. Cancel anytime.
            </p>

            {/* Logout link */}
            <div className="text-center mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Sign out and use a different account
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-[#0f172a] py-4">
        <p className="text-center text-sm text-slate-400">
          © 2025 Bench Coach. Helping volunteer coaches succeed.
        </p>
      </div>
    </div>
  )
}

export default function SubscribePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    }>
      <SubscribeContent />
    </Suspense>
  )
}
