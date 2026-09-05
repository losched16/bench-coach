'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import Image from 'next/image'
import Link from 'next/link'
import { Loader2, CheckCircle, XCircle, ShieldCheck, Users, AlertTriangle } from 'lucide-react'

// The first screen a league-sponsored coach ever sees.
//
// It has one job: make a coach who has never heard of us believe this is real,
// because their league's name is on it. Everything else — the drills, the
// plans, the AI — they will discover afterwards. So the league's name and logo
// come first and ours comes second, which is the opposite of how a product
// normally introduces itself and is correct here: they trust their league.
//
// Deliberately NOT a second onboarding. Accepting drops them into the ordinary
// dashboard with an ordinary team, because a league coach is a coach.

interface InvitationInfo {
  id: string
  email: string
  intendedRole: string
  leagueName: string
  leagueLogoUrl: string | null
  teamId: string | null
  teamName: string | null
  teamAgeGroup: string | null
  divisionName: string | null
  licensed: boolean
}

// Shared with the dashboard and onboarding, which both bounce a signed-in user
// back here if they arrive holding one of these. Distinct from the team invite
// key so a coach mid-way through one flow is never dragged into the other.
const PENDING_KEY = 'pendingLeagueInviteToken'

export default function LeagueInviteAcceptPage() {
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
  // The invitation was addressed to one person and somebody else is signed in.
  // Not refused — see validateInvitation — but confirmed, so a forwarded link
  // is not accepted by the wrong coach without either of them noticing.
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false)

  useEffect(() => {
    try { sessionStorage.setItem(PENDING_KEY, token) } catch { /* private mode */ }

    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      setUser(user)

      try {
        const res = await fetch(`/api/league/invite/accept?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'We could not load that invitation.')
          return
        }
        setInvitation(data.invitation)
      } catch {
        if (!cancelled) setError('We could not load that invitation.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const emailMismatch =
    !!user?.email && !!invitation?.email &&
    user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()

  const handleAccept = async () => {
    if (!user) {
      // Signup rather than login: most people holding one of these have never
      // had an account. The redirect carries the token so they land back here.
      router.push(`/auth/signup?redirect=/league/invite/${token}`)
      return
    }

    setAccepting(true)
    setError(null)
    try {
      const res = await fetch('/api/league/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, userId: user.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'We could not accept that invitation.')
        return
      }

      try { sessionStorage.removeItem(PENDING_KEY) } catch { /* private mode */ }
      setSuccess(true)
      setJoinedTeamId(data.teamId || null)
    } catch {
      setError('We could not accept that invitation.')
    } finally {
      setAccepting(false)
    }
  }

  const dashboardHref = joinedTeamId ? `/dashboard?teamId=${joinedTeamId}` : '/dashboard'
  const roleLabel = invitation?.intendedRole === 'assistant_coach' ? 'Assistant coach' : 'Head coach'

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 flex flex-col">
      <header className="bg-[#0f172a] shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/">
            <Image src="/logo.png" alt="Bench Coach" width={160} height={45} className="h-10 w-auto" priority />
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-4 py-8 sm:py-12">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="animate-spin mx-auto text-gray-400 mb-4" size={44} />
              <p className="text-gray-600">Loading your invitation…</p>
            </div>
          ) : success ? (
            <div className="p-8 sm:p-10 text-center">
              <CheckCircle className="mx-auto text-green-500 mb-4" size={48} />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set</h2>
              <p className="text-gray-700 mb-1">
                {invitation?.teamName
                  ? <>You&apos;re coaching <strong>{invitation.teamName}</strong>.</>
                  : <>Your BenchCoach account is ready.</>}
              </p>
              <p className="text-sm text-gray-500 mb-7">
                Provided by {invitation?.leagueName}.
              </p>
              <Link
                href={joinedTeamId ? `/dashboard/practice?teamId=${joinedTeamId}` : '/dashboard/practice'}
                className="block w-full py-3.5 bg-red-600 text-white rounded-xl font-bold active:bg-red-700"
              >
                Build My First Practice
              </Link>
              <Link href={dashboardHref} className="block mt-3 text-sm text-gray-500 hover:text-gray-700">
                Or go to my dashboard
              </Link>
            </div>
          ) : error && !invitation ? (
            <div className="p-8 sm:p-10 text-center">
              <XCircle className="mx-auto text-red-500 mb-4" size={44} />
              <h2 className="text-xl font-bold text-gray-900 mb-2">This invitation isn&apos;t usable</h2>
              <p className="text-gray-600 mb-7">{error}</p>
              <Link href="/" className="inline-block px-6 py-3 bg-gray-900 text-white rounded-xl font-semibold">
                Go to BenchCoach
              </Link>
            </div>
          ) : invitation ? (
            <>
              {/* The league leads. Their logo if we have it, their name either
                  way — this is the only thing on the screen the coach already
                  trusts. */}
              <div className="bg-[#0f172a] px-6 py-9 text-center">
                {invitation.leagueLogoUrl ? (
                  // Not next/image: a league's logo is an arbitrary external
                  // URL and next/image would need every league's host in
                  // next.config.js before the first one could sign up.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={invitation.leagueLogoUrl}
                    alt={invitation.leagueName}
                    className="h-16 w-auto mx-auto mb-4 object-contain"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-4">
                    <Users className="text-white" size={26} />
                  </div>
                )}
                <h1 className="text-xl sm:text-2xl font-bold text-white leading-snug">
                  {invitation.leagueName} has provided you with BenchCoach
                </h1>
              </div>

              <div className="p-6 sm:p-8 space-y-6">
                <p className="text-[15px] text-gray-700 leading-relaxed text-center">
                  BenchCoach helps you plan practices, find the right drills, and get
                  coaching guidance throughout the season.
                </p>

                {invitation.teamName && (
                  <div className="border border-gray-200 rounded-xl p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      Your team
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <span className="text-lg font-bold text-gray-900">{invitation.teamName}</span>
                      {invitation.teamAgeGroup && (
                        <span className="text-sm text-gray-500">{invitation.teamAgeGroup}</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      {roleLabel}
                      {invitation.divisionName ? ` · ${invitation.divisionName}` : ''}
                    </div>
                  </div>
                )}

                {/* Said explicitly. "Do I have to pay for this?" is the first
                    question a volunteer coach asks, and leaving it to be
                    inferred is how an invitation goes unaccepted. */}
                <div className="flex gap-3 bg-green-50 border border-green-100 rounded-xl p-4">
                  <ShieldCheck className="text-green-600 shrink-0 mt-0.5" size={20} />
                  <p className="text-sm text-green-900">
                    Your league is covering this. There&apos;s nothing for you to buy,
                    now or later in the season.
                  </p>
                </div>

                {!invitation.licensed && (
                  <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                    <p className="text-sm text-amber-900">
                      {invitation.leagueName}&apos;s BenchCoach access isn&apos;t active at the
                      moment, so this invitation can&apos;t be accepted yet. Your commissioner
                      can sort that out.
                    </p>
                  </div>
                )}

                {emailMismatch && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                      <div className="text-sm text-amber-900">
                        <p>
                          This invitation was sent to <strong>{invitation.email}</strong>, and
                          you&apos;re signed in as <strong>{user?.email}</strong>.
                        </p>
                        <p className="mt-2">
                          If this invitation is meant for you, carry on — it will attach to the
                          account you&apos;re in now.
                        </p>
                        <label className="mt-3 flex items-center gap-2 font-medium">
                          <input
                            type="checkbox"
                            checked={mismatchAcknowledged}
                            onChange={e => setMismatchAcknowledged(e.target.checked)}
                            className="w-4 h-4 rounded border-amber-400"
                          />
                          This invitation is for me
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
                    {error}
                  </p>
                )}

                <div>
                  <button
                    onClick={handleAccept}
                    disabled={accepting || !invitation.licensed || (emailMismatch && !mismatchAcknowledged)}
                    className="w-full py-3.5 bg-red-600 text-white rounded-xl font-bold active:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {accepting ? (
                      <><Loader2 className="animate-spin" size={19} /> Setting you up…</>
                    ) : (
                      'Accept Invitation'
                    )}
                  </button>

                  {!user && (
                    <p className="text-center text-sm text-gray-500 mt-3">
                      You&apos;ll create your login on the next screen — it takes a moment.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <footer className="bg-[#0f172a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-slate-400 text-sm">
            © {new Date().getFullYear()} Bench Coach. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
