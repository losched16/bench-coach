'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Link from 'next/link'
import Image from 'next/image'

function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const supabase = createSupabaseComponentClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (authError) throw authError

      if (authData.user) {
        // Create or update coach profile (upsert to handle existing records)
        const { error: coachError } = await supabase
          .from('coaches')
          .upsert({
            user_id: authData.user.id,
            display_name: displayName,
          } as any, {
            onConflict: 'user_id',
          })

        if (coachError) throw coachError

        // Check for pending invite - go there instead of paywall
        const pendingInvite = sessionStorage.getItem('pendingInviteToken')
        if (pendingInvite) {
          router.push(`/invite/${pendingInvite}`)
        } else if (redirect) {
          router.push(redirect)
        } else {
          // New users without invite go to paywall
          router.push('/subscribe')
        }
        router.refresh()
      }
    } catch (error: any) {
      setError(error.message || 'Failed to sign up')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Dark Navy Header */}
      <div className="bg-[#0f172a] py-8">
        <div className="flex justify-center">
          <Image 
            src="/logo.png" 
            alt="Bench Coach" 
            width={280} 
            height={80}
            className="h-16 w-auto"
            priority
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 px-4 py-12">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-xl p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Start Coaching Smarter
              </h1>
              <p className="text-gray-600">
                Create your free account to get started
              </p>
            </div>

            <form onSubmit={handleSignup} className="space-y-6">
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                  Your Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent transition-colors"
                  placeholder="Coach Mike"
                  required
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent transition-colors"
                  placeholder="coach@example.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent transition-colors"
                  placeholder="••••••••"
                  minLength={6}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">At least 6 characters</p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>

              <div className="text-center text-sm text-gray-600">
                Already have an account?{' '}
                <Link href={redirect ? `/auth/login?redirect=${encodeURIComponent(redirect)}` : '/auth/login'} className="text-red-600 hover:text-red-700 font-medium">
                  Sign in
                </Link>
              </div>
            </form>
          </div>

          <div className="mt-6 text-center text-sm text-gray-500">
            <p>Join coaches getting better results with less stress</p>
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

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <SignupForm />
    </Suspense>
  )
}
