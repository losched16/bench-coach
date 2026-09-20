'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, X, ChevronRight, Rocket } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useUiPref, ONBOARDING_PREF_KEY } from '@/lib/useUiPref'
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
// WHO NEVER SEES THIS
//
//   * anyone who already has a saved plan — they are not a new user, whatever
//     their account age says
//   * anyone who cannot create plans. Offering an assistant coach a checklist
//     whose middle step they are not allowed to perform would be worse than
//     showing them nothing.
//   * anyone who skipped it
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

interface Progress {
  hasTeam: boolean
  hasRoster: boolean
  hasPlan: boolean
  loaded: boolean
}

export function FirstPracticeChecklist({ teamId, canCreatePlans }: Props) {
  const supabase = createSupabaseComponentClient()
  const track = useTracker()
  const { value, ready, set } = useUiPref(ONBOARDING_PREF_KEY)
  const [p, setP] = useState<Progress>({
    hasTeam: false, hasRoster: false, hasPlan: false, loaded: false,
  })

  const skipped = !!value?.skipped
  const started = !!value?.startedAt

  const load = useCallback(async () => {
    if (!teamId) { setP(s => ({ ...s, loaded: true })); return }
    try {
      const [{ count: players }, { count: plans }] = await Promise.all([
        supabase.from('team_players').select('id', { count: 'exact', head: true })
          .eq('team_id', teamId),
        supabase.from('practice_plans').select('id', { count: 'exact', head: true })
          .eq('team_id', teamId),
      ])
      setP({
        hasTeam: true,
        hasRoster: (players || 0) > 0,
        hasPlan: (plans || 0) > 0,
        loaded: true,
      })
    } catch {
      // A failed count must not block the dashboard. Treat it as "nothing to
      // show" rather than guessing the coach is new.
      setP({ hasTeam: !!teamId, hasRoster: true, hasPlan: true, loaded: true })
    }
  }, [teamId, supabase])

  useEffect(() => { load() }, [load])

  // Fires once, when a genuinely new coach first sees it.
  useEffect(() => {
    if (!ready || !p.loaded || skipped || started) return
    if (p.hasPlan || !canCreatePlans) return
    track('onboarding_started', { checklist: 'first-practice' })
    set({ startedAt: new Date().toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.loaded, skipped, started, p.hasPlan, canCreatePlans])

  // Completion is a fact about the database, so it is announced when it
  // becomes true rather than when a button is pressed.
  useEffect(() => {
    if (!ready || !p.loaded || !p.hasPlan) return
    if (value?.completedAt) return
    if (!started) return
    track('onboarding_completed', { checklist: 'first-practice' })
    set({ completedAt: new Date().toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.loaded, p.hasPlan, started, value?.completedAt])

  if (!ready || !p.loaded) return null
  if (skipped) return null
  // Already has a plan and was never mid-checklist: an existing coach, not a
  // new one. Nothing to show them.
  if (p.hasPlan && !started) return null
  // Finished it in an earlier session.
  if (p.hasPlan && value?.completedAt && !value?.keepOpen) return null
  if (!canCreatePlans) return null
  if (!teamId) return null

  const steps = [
    {
      key: 'team',
      label: 'Your team is set up',
      done: p.hasTeam,
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

  const complete = p.hasPlan
  const next = steps.find(s => !s.done && s.href)

  return (
    <div className="bg-white border border-red-200 rounded-lg shadow-sm overflow-hidden">
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
            Nothing here ticks itself when you open a page — a step is done when the
            work is actually saved.
          </p>
        </div>
      )}
    </div>
  )
}
