'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, X, ChevronRight, Rocket } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useUiPref, ONBOARDING_PREF_KEY } from '@/lib/useUiPref'
import { checklistDecision, ChecklistFacts, LoadStatus } from '@/lib/onboarding'
import { useTracker } from '@/lib/tracking'

// "Create your first practice", for a coach who has just signed up.
//
// COMPLETION IS MEASURED FROM DOMAIN DATA, NOT FROM CLICKS.
//
// A checklist that ticks itself when you open a page is a checklist that lies.
// Every step below is answered by a row existing:
//
//   team      a team is selected and readable
//   roster    team_players has at least one row for this team
//   plan      practice_plans has at least one row for this team
//
// Opening the practice page does not tick anything. Pressing Generate does not
// tick anything. Pressing "Use this plan" does, because that is the press that
// writes the row. The brief is explicit that a page view is not completion and
// that no meaningless extra click should exist to satisfy a checklist — so
// there is no "mark as done" button anywhere in here.
//
// AN UNANSWERED QUESTION IS NOT AN ANSWER OF NO.
//
// Supabase reports a failed count by RETURNING an error, not by throwing, so a
// try/catch around these calls catches almost nothing that actually goes wrong.
// A count that comes back `{ count: null, error: {...} }` destructured for
// `count` alone reads as zero rows — which is indistinguishable, here, from a
// brand new coach. That would show an established coach an onboarding
// checklist and, worse, fire onboarding_started at them.
//
// So the load below has three outcomes, not two: answered, unavailable, and
// still going. Only `answered` renders anything or reports anything. Both
// errors are checked explicitly, and a request that resolves after the coach
// has switched teams is dropped rather than applied to the wrong team.
//
// WHO NEVER SEES THIS
//
//   * anyone who already has a saved plan — they are not a new user, whatever
//     their account age says
//   * anyone who cannot create plans. Offering an assistant coach a checklist
//     whose middle step they are not allowed to perform would be worse than
//     showing them nothing.
//   * anyone who skipped it
//   * anyone whose roster and plan counts could not be read
//
// ...unless they asked for it back from the Help Center, which sets
// `reopenedAt`. A coach who reopens it sees the true state of their own data,
// including "already done" — reopening never invents completion, and because
// `completedAt` is preserved across a reopen it never reports completion twice.
//
// A ROSTER IS NOT REQUIRED TO FINISH. The practice builder works without one,
// so the roster step is marked optional rather than blocking. Inventing a
// prerequisite the product does not have would send coaches to do work they do
// not need to do before their first practice.

interface Props {
  teamId: string | null
  /** False for a coach who may not create practice plans. */
  canCreatePlans: boolean
}

const PENDING: ChecklistFacts = {
  status: 'loading' as LoadStatus, teamId: null, hasRoster: false, hasPlan: false,
}

export function FirstPracticeChecklist({ teamId, canCreatePlans }: Props) {
  const supabase = createSupabaseComponentClient()
  const track = useTracker()
  const { value, ready, set } = useUiPref(ONBOARDING_PREF_KEY)
  const [p, setP] = useState<ChecklistFacts>(PENDING)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    if (!teamId) {
      setP({ status: 'unavailable', teamId: null, hasRoster: false, hasPlan: false })
      return
    }
    setP(PENDING)

    let players: { count: number | null; error: unknown }
    let plans: { count: number | null; error: unknown }
    try {
      const [a, b] = await Promise.all([
        supabase.from('team_players').select('id', { count: 'exact', head: true })
          .eq('team_id', teamId),
        supabase.from('practice_plans').select('id', { count: 'exact', head: true })
          .eq('team_id', teamId),
      ])
      players = { count: a.count, error: a.error }
      plans = { count: b.count, error: b.error }
    } catch (e) {
      // The client threw outright — offline, aborted, a bad URL.
      players = { count: null, error: e }
      plans = { count: null, error: e }
    }

    // The coach moved on while this was in flight. Their new team's request is
    // already running; this answer describes somewhere else.
    if (mine !== seq.current) return

    // THE CHECK THAT WAS MISSING. An error, or a null count on a successful
    // response, means we do not know — and not knowing must not be rendered as
    // a zero.
    if (players.error || plans.error || players.count === null || plans.count === null) {
      setP({ status: 'unavailable', teamId, hasRoster: false, hasPlan: false })
      return
    }

    setP({
      status: 'answered',
      teamId,
      hasRoster: players.count > 0,
      hasPlan: plans.count > 0,
    })
  }, [teamId, supabase])

  useEffect(() => {
    load()
    return () => { seq.current++ }
  }, [load])

  // Every "should this show" and "should this report" rule lives in
  // lib/onboarding.ts and is covered by scripts/test-onboarding.ts.
  const d = checklistDecision({
    facts: p, teamId, canCreatePlans, pref: value, prefReady: ready,
  })

  // Fires once, when a genuinely new coach first sees it.
  useEffect(() => {
    if (!d.trackStarted) return
    track('onboarding_started', { checklist: 'first-practice' })
    set({ startedAt: new Date().toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.trackStarted])

  // Completion is a fact about the database, so it is announced when it
  // becomes true rather than when a button is pressed.
  useEffect(() => {
    if (!d.trackCompleted) return
    track('onboarding_completed', { checklist: 'first-practice' })
    set({ completedAt: new Date().toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.trackCompleted])

  if (!d.visible) return null

  const steps = [
    {
      key: 'team',
      label: 'Your team is set up',
      done: true,
      href: null as string | null,
      cta: null as string | null,
    },
    {
      key: 'roster',
      label: 'Add your players',
      // True of the product, so said out loud rather than enforced.
      hint: 'Optional — you can build a practice before your roster is in.',
      done: p.hasRoster,
      href: `/dashboard/roster?teamId=${teamId}`,
      cta: 'Open Roster',
    },
    {
      key: 'plan',
      label: 'Build a practice and save it',
      hint: 'It is not saved until you press “Use this plan”.',
      done: p.hasPlan,
      href: `/dashboard/practice?teamId=${teamId}`,
      cta: 'Open Practice Plans',
    },
  ]

  const complete = d.complete
  const next = steps.find(s => !s.done && s.href)

  return (
    <div
      data-testid="first-practice-checklist"
      className="bg-white border border-red-200 rounded-lg shadow-sm overflow-hidden"
    >
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Rocket size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-gray-900">
              {complete ? 'You have your first practice plan' : 'Get to your first practice plan'}
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {complete
                ? 'That is the part that matters. Print it and take it to the field.'
                : 'Three steps. The last one is the one that counts.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            track(complete ? 'onboarding_dismissed' : 'onboarding_skipped',
              { checklist: 'first-practice' })
            set({ skipped: true })
          }}
          aria-label={complete ? 'Hide this' : 'Skip this'}
          className="flex-shrink-0 p-1.5 -mr-1 -mt-1 text-gray-400 hover:text-gray-700 rounded"
        >
          <X size={16} />
        </button>
      </div>

      <ol className="border-t border-gray-100 divide-y divide-gray-50">
        {steps.map(s => (
          <li key={s.key} className="px-4 py-3 flex items-center gap-3">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              s.done ? 'bg-green-100 text-green-700' : 'border border-gray-300'}`}>
              {s.done && <Check size={13} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm ${s.done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                {s.label}
              </span>
              {!s.done && 'hint' in s && s.hint && (
                <span className="block text-xs text-gray-500 mt-0.5">{s.hint}</span>
              )}
            </span>
            {!s.done && s.href && (
              <Link
                href={s.href}
                onClick={() => track('onboarding_step_opened', {
                  checklist: 'first-practice', step: s.key,
                })}
                className="flex-shrink-0 text-sm font-medium text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                {s.cta} <ChevronRight size={15} />
              </Link>
            )}
          </li>
        ))}
      </ol>

      {complete && (
        <div className="px-4 py-3 bg-green-50 border-t border-green-100">
          <Link
            href={`/dashboard/practice?teamId=${teamId}`}
            className="text-sm font-medium text-green-800 hover:text-green-900"
          >
            Print your plan →
          </Link>
        </div>
      )}

      {!complete && next && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            A step is ticked when the work is saved, so you can leave and come back.
          </p>
        </div>
      )}
    </div>
  )
}
