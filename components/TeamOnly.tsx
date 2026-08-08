'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useEntitlements } from '@/lib/useEntitlements'
import { Users, ArrowRight, Sparkles, Plus } from 'lucide-react'

// The screen a coaching surface shows when it cannot work here.
//
// Two different things send someone to this component, and telling them apart
// is the whole point:
//
//   1. They are on the Personal plan. Scouting is not something they have. The
//      honest screen says what it does and what it costs — an error banner
//      saying "402" teaches them nothing and reads like a bug.
//
//   2. They are on the Coach plan but standing in a personal workspace. This
//      is not a billing problem at all — their opponents exist, they are just
//      filed under a team. Selling them something they already own would be
//      insulting; the fix is one tap to the right workspace.
//
// Before this, both produced the same red banner, and case 2 produced it under
// a heading that said "Your scouting data is still there" — which was true,
// unhelpful, and directly beneath an empty list saying otherwise.

type Feature = 'scouting' | 'lineup' | 'practice' | 'staff'

const COPY: Record<Feature, { name: string; does: string; why: string }> = {
  scouting: {
    name: 'Scouting',
    does: 'Log a box score after every game and it builds the opponent — who pitched, how far they went, and who is legal to throw against you next weekend.',
    why: 'Opponents are scouted for a team to play against.',
  },
  lineup: {
    name: 'The lineup builder',
    does: 'Position locks, innings minimums and sit-count fairness, worked out for you before the game rather than argued about after it.',
    why: 'A lineup needs a roster to make one from.',
  },
  practice: {
    name: 'Practice plans',
    does: 'A plan built around what your roster actually needs this week, with the drills and the time on each one.',
    why: 'A practice plan is built for a team.',
  },
  staff: {
    name: 'Staff',
    does: 'Assistant coaches and team parents with their own logins, each seeing exactly as much as you give them.',
    why: 'Staff are invited onto a team.',
  },
}

interface Props {
  feature: Feature
  // The workspace currently selected in the header.
  teamId: string | null | undefined
  children: React.ReactNode
}

export function TeamOnly({ feature, teamId, children }: Props) {
  const [coachId, setCoachId] = useState<string | null>(null)
  const [resolvedCoach, setResolvedCoach] = useState(false)
  const supabase = createSupabaseComponentClient()
  const { teamFeatures, label, workspaces, loading } = useEntitlements(coachId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: coach } = await supabase
          .from('coaches')
          .select('id')
          .eq('user_id', user.id)
          .single() as { data: { id: string } | null }
        if (!cancelled && coach) setCoachId(coach.id)
      } finally {
        if (!cancelled) setResolvedCoach(true)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Optimistic while we find out, like the nav. The page underneath shows its
  // own loading state, so this is not a flash of the wrong thing — and the
  // alternative is a beat of blank on every load for the coaches who are fine.
  if (!resolvedCoach || loading) return <>{children}</>

  if (!teamFeatures) return <UpgradePrompt feature={feature} currentPlan={label} />

  const teams = workspaces.filter(w => w.kind === 'team')
  const here = workspaces.find(w => w.id === teamId)

  // Only intervene when we are sure this is a personal workspace. An unknown
  // id — a team shared with them, a stale link — is not grounds for hiding a
  // page they are entitled to.
  if (here?.kind === 'personal') {
    return <WrongWorkspace feature={feature} teams={teams} standingIn={here.name} />
  }

  return <>{children}</>
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-lg mx-auto py-6">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        {children}
      </div>
    </div>
  )
}

function UpgradePrompt({ feature, currentPlan }: { feature: Feature; currentPlan: string }) {
  const c = COPY[feature]
  return (
    <Shell>
      <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center">
        <Sparkles size={22} className="text-red-600" />
      </div>

      <h2 className="text-xl font-bold text-gray-900 mt-4">
        {c.name} comes with the Coach plan
      </h2>
      <p className="text-[15px] text-gray-700 mt-2 leading-relaxed">{c.does}</p>

      <div className="mt-5 border-t border-gray-100 pt-4">
        <p className="text-sm font-semibold text-gray-900">Coach also adds</p>
        <ul className="mt-2 space-y-1.5">
          {[
            'Unlimited teams and players',
            'The lineup builder, with position locks and innings minimums',
            'Practice plans built around what your team needs',
            'Opponent scouting and pitching availability',
            'Assistant coaches, with their own logins',
          ].map(f => (
            <li key={f} className="flex gap-2 text-sm text-gray-700">
              <span className="text-red-600 mt-0.5">•</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link
        href="/subscribe"
        className="mt-5 w-full flex items-center justify-center gap-2 py-3.5 bg-red-600 text-white rounded-xl font-bold active:bg-red-700"
      >
        See the Coach plan
        <ArrowRight size={17} />
      </Link>

      {/* Said plainly, because the fear on this screen is "have I lost my
          stuff?" and the answer is no. */}
      <p className="text-xs text-gray-500 mt-3 text-center">
        You are on {currentPlan}. Everything you have already logged stays exactly
        where it is either way.
      </p>
    </Shell>
  )
}

function WrongWorkspace({
  feature, teams, standingIn,
}: {
  feature: Feature
  teams: Array<{ id: string; name: string }>
  standingIn: string
}) {
  const c = COPY[feature]
  const pathname = usePathname()
  const router = useRouter()

  return (
    <Shell>
      <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center">
        <Users size={22} className="text-blue-600" />
      </div>

      <h2 className="text-xl font-bold text-gray-900 mt-4">
        Pick a team for {c.name.toLowerCase()}
      </h2>
      <p className="text-[15px] text-gray-700 mt-2 leading-relaxed">
        You are in <strong>{standingIn}</strong> right now, which is your own
        player. {c.why}
      </p>

      {teams.length > 0 ? (
        <>
          <div className="mt-5 space-y-2">
            {teams.map(t => (
              <button
                key={t.id}
                onClick={() => router.push(`${pathname}?teamId=${t.id}`)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 border border-gray-200 rounded-xl text-left active:bg-gray-50"
              >
                <span className="font-semibold text-gray-900">{t.name}</span>
                <ArrowRight size={17} className="text-gray-400 shrink-0" />
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3 text-center">
            You can switch back any time from the picker at the top.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600 mt-4">
            You have not set up a team yet — your plan covers as many as you want.
          </p>
          <Link
            href="/dashboard/new-team"
            className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 bg-gray-900 text-white rounded-xl font-bold active:bg-gray-800"
          >
            <Plus size={17} />
            Set up a team
          </Link>
        </>
      )}
    </Shell>
  )
}
