'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Image from 'next/image'
import { Check, Loader2, Shield } from 'lucide-react'

function SubscribeContent() {
  const [loading, setLoading] = useState(true)
  // Which plan's button is spinning — two cards means a boolean can't say.
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [plans, setPlans] = useState<any[]>([])
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

  // Straight from lib/tiers.ts via the API, so the page can't drift from what
  // the limits actually enforce.
  useEffect(() => {
    if (!user?.id) return
    fetch(`/api/entitlements?userId=${user.id}`)
      .then(r => r.json())
      .then(d => setPlans(d.plans || []))
      .catch(() => {})
  }, [user?.id])

  const handleCheckout = async (tier: string) => {
    setCheckoutLoading(tier)
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          tier,
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
      setCheckoutError(error.message || 'Could not start checkout.')
      setCheckoutLoading(null)
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

            {/* Plans. Rendered from lib/tiers.ts rather than typed here, so
                the card and the limit that enforces it can't disagree. */}
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              {plans.map(plan => (
                <div
                  key={plan.id}
                  className={`rounded-xl border p-5 flex flex-col ${
                    plan.id === 'team'
                      ? 'border-amber-300 ring-1 ring-amber-100 bg-amber-50/40'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-gray-900">{plan.label}</h3>
                      {plan.id === 'team' && (
                        <span className="text-xs px-2 py-0.5 bg-amber-500 text-white rounded-full">
                          Most coaches
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{plan.tagline}</p>
                    <p className="text-xs text-gray-500 mt-1">{plan.audience}</p>
                  </div>

                  <ul className="space-y-2 mb-4 flex-1">
                    {plan.features.map((f: string) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="text-green-500 flex-shrink-0 mt-0.5" size={16} />
                        <span className="text-sm text-gray-700">{f}</span>
                      </li>
                    ))}
                  </ul>

                  {plan.purchasable ? (
                    <button
                      onClick={() => handleCheckout(plan.id)}
                      disabled={!!checkoutLoading}
                      className={`w-full py-3 font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
                        plan.id === 'team'
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600'
                          : 'bg-slate-900 text-white hover:bg-slate-800'
                      }`}
                    >
                      {checkoutLoading === plan.id
                        ? <Loader2 className="animate-spin" size={20} />
                        : <span>Start 14-day free trial</span>}
                    </button>
                  ) : (
                    /* No price configured yet. A dead button is worse than an
                       honest label — this is what the coach sees until
                       STRIPE_PRICE_* is set. */
                    <div className="w-full py-3 text-center text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg">
                      Coming soon
                    </div>
                  )}
                </div>
              ))}
            </div>

            {plans.length === 0 && (
              <div className="text-center text-sm text-gray-500 py-6">
                <Loader2 className="animate-spin mx-auto mb-2" size={20} />
                Loading plans…
              </div>
            )}

            {checkoutError && (
              <p className="text-sm text-red-700 text-center mb-3">{checkoutError}</p>
            )}

            <p className="text-xs text-gray-500 text-center mt-2 mb-4">
              You won&apos;t be charged until your trial ends. Cancel anytime, and switch plans
              whenever you like.
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
