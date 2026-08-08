'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, Loader2, AlertCircle, Target, Check,
  ClipboardList, User, Play, Sparkles, Trash2, Repeat,
  ChevronUp, ChevronDown, ArrowRight,
} from 'lucide-react'
import { PlanStep } from '@/lib/progression'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { focusAreaLabel, focusAreaChip, FOCUS_AREAS, FocusArea } from '@/lib/focusAreas'
import { DrillSwap } from './DrillSwap'
import { DrillVideo } from './DrillVideo'

// Plans, as cards.
//
// What this replaces: a single scrolling column where every priority rendered
// its drills, its plan, its prose and an update box all at once, wrapped in a
// three-week countdown that told a parent when they were allowed to move on.
//
// Two things were wrong with that, and only one was layout.
//
// The layout: nothing was findable. Three priorities made one enormous page and
// the drills — the only part anyone acts on — were four disclosures deep.
//
// The clock: a plan that says "day 12 of 21" is telling a parent that the app
// knows better than they do when their kid has got it. It doesn't. A parent
// standing in a driveway watching the swing knows. So the countdown is gone;
// the plan runs until they say it's done.
//
// What is left is: here are your plans, here is what each one is fixing, here
// are the drills with a video, and here is a button for when it's fixed.

interface PlanSummary {
  id: string
  scope: 'player' | 'team'
  focusArea: string | null
  subjectName: string
  priority: string | null
  successCriteria: string | null
  playerId: string | null
}

// Straight off drill_resources — the route returns the rows unmapped, so the
// column names are the contract.
interface Drill {
  id: string
  drill_name: string
  description: string | null
  ai_coaching_notes: string | null
  youtube_url: string | null
  youtube_video_id: string | null
  youtube_start_seconds?: number | null
  equipment_needed: string[] | null
  skill_category: string | null
  // Curated in migrations 004 and 008, returned by the route since day one,
  // and rendered nowhere until now — which is why four drills that build on
  // each other looked like four alternatives.
  progression_level?: number | null
  difficulty_level?: string | null
  reps_guidance?: string | null
  frequency_guidance?: string | null
  success_markers?: string[] | null
}

interface PracticePlan {
  id: string
  title: string
  duration_minutes: number | null
  created_at: string
}

interface Props {
  teamId: string | null
}

export function PlanCards({ teamId }: Props) {
  const supabase = createSupabaseComponentClient()

  const [coachId, setCoachId] = useState<string | null>(null)
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [practice, setPractice] = useState<PracticePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async (cid: string) => {
    try {
      const params = new URLSearchParams({ coachId: cid })
      if (teamId) params.set('teamId', teamId)
      const res = await fetch(`/api/checkin?${params}`)
      const d = await res.json()
      if (d.needsMigration) {
        setMigrationMessage(d.migrationMessage || 'Your database is missing something this page needs.')
        return
      }
      if (d.error) { setLoadError(d.error); return }
      setLoadError(null)
      setPlans(d.prescriptions || [])
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your plans.')
    }
  }, [teamId])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: coach } = await supabase
        .from('coaches').select('id').eq('user_id', user.id).single() as { data: { id: string } | null }
      if (!coach) { setLoading(false); return }
      setCoachId(coach.id)
      await load(coach.id)

      if (teamId) {
        const { data: pp } = await supabase
          .from('practice_plans')
          .select('id, title, duration_minutes, created_at')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })
          .limit(6)
        setPractice((pp || []) as PracticePlan[])
      }
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  // Deleting is not closing out. Closing means it worked and the record stays;
  // this is for a duplicate or a mistake. Said plainly in the confirm, because
  // the two live next to each other and only one is reversible by starting
  // over.
  const remove = async (p: PlanSummary) => {
    if (!coachId) return
    const ok = confirm(
      `Delete this plan for ${p.subjectName}?\n\n` +
      `Sessions you've already logged are kept — only the plan itself goes. ` +
      `If it worked, use "close this plan" instead so the result is on the record.`
    )
    if (!ok) return
    setDeleting(p.id)
    try {
      const res = await fetch(
        `/api/prescribe/commit?coachId=${coachId}&prescriptionId=${p.id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not delete that')
      }
      setPlans(prev => prev.filter(x => x.id !== p.id))
    } catch (e: any) {
      setLoadError(e.message)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Loader2 className="animate-spin" size={16} /> Loading your plans…
      </div>
    )
  }

  const open = openId ? plans.find(p => p.id === openId) : null
  if (open && coachId) {
    return (
      <PlanDetail
        plan={open}
        coachId={coachId}
        teamId={teamId}
        onBack={() => setOpenId(null)}
        onClosedOut={async () => { setOpenId(null); await load(coachId) }}
      />
    )
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {migrationMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-sm text-amber-900">
          <AlertCircle className="text-amber-600 shrink-0" size={18} />
          <p>{migrationMessage}</p>
        </div>
      )}
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 text-sm text-red-800">
          <AlertCircle className="text-red-600 shrink-0" size={18} />
          <p>Couldn&apos;t load your plans: {loadError}</p>
        </div>
      )}

      {/* ── Player plans ───────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <User size={18} className="text-gray-400" />
          <h2 className="text-lg font-bold text-gray-900">Player plans</h2>
        </div>

        {plans.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
            <Target className="mx-auto text-gray-300 mb-2" size={28} />
            <p className="text-gray-800 font-medium">No plans yet</p>
            <p className="text-sm text-gray-600 mt-1">
              Log an entry or ask CoachAI about something you want to fix, then tap
              <strong> Make this the priority</strong> on the answer.
            </p>
            <Link
              href={`/dashboard/chat?teamId=${teamId || ''}`}
              className="inline-block mt-3 px-5 py-3 bg-red-600 text-white rounded-xl font-bold"
            >
              Ask CoachAI
            </Link>
          </div>
        ) : (
          plans.map(p => (
            <div
              key={p.id}
              className="bg-white border border-gray-200 rounded-xl hover:border-red-300 transition-colors"
            >
              <div className="flex items-center gap-1 p-4">
                <button
                  onClick={() => setOpenId(p.id)}
                  className="flex-1 min-w-0 text-left flex items-center gap-3"
                >
                <div className="flex-1 min-w-0">
                  <span className="block text-lg font-bold text-gray-900">
                    {p.subjectName}
                  </span>
                  {/* The subcategory. Which part of the game this plan is
                      about, directly under the name — four plans on one kid all
                      titled the same thing is unreadable. */}
                  <span
                    className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                      p.focusArea ? focusAreaChip(p.focusArea) : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {p.focusArea ? focusAreaLabel(p.focusArea) : 'Set the area'}
                  </span>
                  {p.priority && (
                    <p className="text-sm text-gray-700 mt-1.5 line-clamp-2">{p.priority}</p>
                  )}
                </div>
                  <ChevronRight size={22} className="shrink-0 text-gray-400" />
                </button>
                <button
                  onClick={() => remove(p)}
                  disabled={deleting === p.id}
                  className="shrink-0 p-2 text-gray-300 hover:text-red-600 disabled:opacity-50"
                  aria-label={`Delete ${p.subjectName}'s plan`}
                >
                  {deleting === p.id
                    ? <Loader2 size={18} className="animate-spin" />
                    : <Trash2 size={18} />}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* ── Team practice plans ────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} className="text-gray-400" />
            <h2 className="text-lg font-bold text-gray-900">Team practice plans</h2>
          </div>
          <Link
            href={`/dashboard/practice?teamId=${teamId || ''}`}
            className="text-sm font-medium text-red-600"
          >
            New plan
          </Link>
        </div>

        {practice.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
            <p className="text-gray-800 font-medium">No practice plans yet</p>
            <Link
              href={`/dashboard/practice?teamId=${teamId || ''}`}
              className="inline-block mt-3 px-5 py-3 bg-gray-900 text-white rounded-xl font-bold"
            >
              Build one
            </Link>
          </div>
        ) : (
          practice.map(pp => (
            <Link
              key={pp.id}
              href={`/dashboard/practice/${pp.id}?teamId=${teamId || ''}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-400 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900">{pp.title}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {pp.duration_minutes ? `${pp.duration_minutes} minutes` : 'Practice plan'}
                  </p>
                </div>
                <ChevronRight size={22} className="shrink-0 text-gray-400" />
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}

// ── One plan ─────────────────────────────────────────────
// What we're fixing, the drills that fix it, and a button for when it's fixed.

function PlanDetail({
  plan, coachId, teamId, onBack, onClosedOut,
}: {
  plan: PlanSummary
  coachId: string
  teamId: string | null
  onBack: () => void
  onClosedOut: () => void
}) {
  const [removing, setRemoving] = useState(false)
  // Which drill the coach is replacing, if any.
  const [swapping, setSwapping] = useState<Drill | null>(null)
  const [drills, setDrills] = useState<Drill[]>([])
  const [steps, setSteps] = useState<PlanStep[]>([])
  const [currentStep, setCurrentStep] = useState(1)
  const [stepping, setStepping] = useState(false)
  // A step the coach opened to look ahead. Looking is free; it does not move
  // the player, which is what currentStep means.
  const [peek, setPeek] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [logging, setLogging] = useState(false)
  const [logged, setLogged] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Locally, so picking one updates the heading without a reload.
  const [area, setArea_] = useState<string | null>(plan.focusArea)
  const [savingArea, setSavingArea] = useState(false)

  const loadDrills = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/prescribe/drills?prescriptionId=${plan.id}&coachId=${coachId}`
      )
      const d = await res.json()
      setDrills(d.drills || [])
      // Falls back to a single step when migration 036 has not been applied,
      // which renders as today's flat list rather than an error.
      setSteps(Array.isArray(d.steps) ? d.steps : [])
      setCurrentStep(d.currentStep || 1)
    } catch { /* the plan still reads without them */ }
    finally { setLoading(false) }
  }, [plan.id, coachId])

  useEffect(() => { loadDrills() }, [loadDrills])

  const moveStep = async (to: number) => {
    setStepping(true)
    setError(null)
    try {
      const res = await fetch('/api/prescribe/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prescriptionId: plan.id, coachId, step: to }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not move to that step')
      setCurrentStep(d.currentStep)
      if (Array.isArray(d.steps) && d.steps.length) setSteps(d.steps)
      // Follow them to the step they just moved to, rather than leaving the
      // old one open under a button that has changed meaning.
      setPeek(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setStepping(false)
    }
  }

  const logSession = async () => {
    setLogging(true)
    setError(null)
    try {
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId, teamId,
          prescriptionId: plan.id,
          playerId: plan.playerId,
          entryType: 'home_session',
          title: 'Worked the priority',
          quickLog: true,
          occurredOn: new Date().toISOString().split('T')[0],
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not save that')
      }
      setLogged(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLogging(false)
    }
  }

  const closeOut = async () => {
    if (!confirm(`Close out ${plan.subjectName}'s plan? You can always start a new one.`)) return
    setClosing(true)
    setError(null)
    try {
      const res = await fetch('/api/checkin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, prescriptionId: plan.id, status: 'resolved' }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not close that out')
      }
      onClosedOut()
    } catch (e: any) {
      setError(e.message)
      setClosing(false)
    }
  }

  const setArea = async (area: FocusArea) => {
    setSavingArea(true)
    try {
      const res = await fetch('/api/prescribe/commit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, prescriptionId: plan.id, focusArea: area }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not set that')
      }
      setArea_(area)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingArea(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        <ChevronLeft size={17} /> All plans
      </button>

      <div>
        <h2 className="text-2xl font-bold text-gray-900">{plan.subjectName}</h2>
        {area ? (
          <span className={`inline-block mt-1.5 text-sm font-semibold px-2.5 py-1 rounded-full ${focusAreaChip(area)}`}>
            {focusAreaLabel(area)}
          </span>
        ) : (
          // Priorities written before areas existed have none, and the
          // classifier cannot always tell from the text. Rather than leave it
          // labelled "General" forever, just ask — it is one tap.
          <div className="mt-2">
            <p className="text-sm text-gray-600 mb-1.5">What is this plan about?</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FOCUS_AREAS) as FocusArea[]).map(k => (
                <button
                  key={k}
                  onClick={() => setArea(k)}
                  disabled={savingArea}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 active:bg-gray-100 disabled:opacity-50"
                >
                  {FOCUS_AREAS[k].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* What we're fixing. One box, plain words, at the top. */}
      {plan.priority && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            What we&apos;re working on
          </h3>
          <p className="text-[15px] text-gray-900 leading-relaxed">{plan.priority}</p>
          {plan.successCriteria && (
            <>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1.5">
                What better looks like
              </h3>
              <p className="text-[15px] text-gray-900 leading-relaxed">{plan.successCriteria}</p>
            </>
          )}
        </div>
      )}

      {/* The progression.
          Steps, not a menu. The library already knew which drills come first —
          progression_level was curated by hand and the route even preserved
          the order — and this screen used to flatten all of it into four
          identical numbered cards. A parent reading that has no way to know
          that card three is the hard version of card one.

          One step is open at a time. Later steps show their name and what has
          to be true before you get there, so the plan is legible end to end
          without pretending the kid is ready for it. */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-900">The plan</h3>
          {steps.length > 1 && (
            <span className="text-sm font-semibold text-gray-500">
              Step {currentStep} of {steps.length}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
            <Loader2 className="animate-spin" size={15} /> Loading the drills…
          </div>
        ) : drills.length === 0 ? (
          <p className="text-sm text-gray-500">
            No drills on this plan yet.
          </p>
        ) : steps.length === 0 ? (
          /* No progression could be worked out — show the drills plainly
             rather than inventing stages the library cannot support. */
          drills.map((d, i) => (
            <DrillCard
              key={d.id}
              drill={d}
              n={i + 1}
              onSwap={() => setSwapping(d)}
            />
          ))
        ) : (
          steps.map(step => {
            const open = (peek ?? currentStep) === step.n
            const done = step.n < currentStep
            const ahead = step.n > currentStep
            const stepDrills = step.drillIds
              .map(id => drills.find(d => d.id === id))
              .filter(Boolean) as Drill[]

            return (
              <div
                key={step.n}
                className={`rounded-xl border ${
                  open ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <button
                  onClick={() => setPeek(open ? null : step.n)}
                  className="w-full flex items-start gap-3 p-4 text-left"
                >
                  <span
                    className={`shrink-0 w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center ${
                      done ? 'bg-green-600 text-white'
                        : ahead ? 'bg-gray-200 text-gray-500'
                        : 'bg-gray-900 text-white'
                    }`}
                  >
                    {done ? <Check size={16} /> : step.n}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-gray-900">{step.title}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {done ? 'Done'
                        : ahead ? 'Coming up'
                        : 'Working on this now'}
                      {' · '}
                      {stepDrills.length} {stepDrills.length === 1 ? 'drill' : 'drills'}
                    </span>
                  </span>
                  {open
                    ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
                    : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                </button>

                {open && (
                  <div className="px-4 pb-4 space-y-3">
                    <p className="text-[15px] text-gray-700 leading-relaxed">{step.why}</p>

                    {stepDrills.map((d, i) => (
                      <DrillCard
                        key={d.id}
                        drill={d}
                        n={i + 1}
                        onSwap={() => setSwapping(d)}
                      />
                    ))}

                    {/* The gate. This is the whole difference between a
                        progression and a list: something observable that says
                        he is ready, rather than a date. */}
                    {step.moveOnWhen.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
                        <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                          Move on when he can
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {step.moveOnWhen.map(m => (
                            <li key={m} className="flex gap-2 text-[15px] text-amber-900">
                              <span className="mt-0.5">•</span>
                              <span>{m}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {step.n === currentStep && step.n < steps.length && (
                      <button
                        onClick={() => moveStep(step.n + 1)}
                        disabled={stepping}
                        className="w-full py-3.5 rounded-xl bg-gray-900 text-white font-bold flex items-center justify-center gap-2 active:bg-gray-800 disabled:opacity-60"
                      >
                        {stepping
                          ? <Loader2 className="animate-spin" size={17} />
                          : <ArrowRight size={17} />}
                        He&apos;s got this — go to step {step.n + 1}
                      </button>
                    )}

                    {/* Going back is normal. A swing that holds up on a tee and
                        falls apart against live pitching is the most common
                        thing that happens in a progression, and a plan that
                        treats that as failure teaches parents to lie to it. */}
                    {step.n === currentStep && step.n > 1 && (
                      <button
                        onClick={() => moveStep(step.n - 1)}
                        disabled={stepping}
                        className="w-full py-2.5 text-sm text-gray-600 font-medium disabled:opacity-60"
                      >
                        Not holding up — go back to step {step.n - 1}
                      </button>
                    )}

                    {ahead && (
                      <p className="text-xs text-gray-500">
                        You are looking ahead. He is on step {currentStep} — finish
                        that one first.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {swapping && (
        <DrillSwap
          coachId={coachId}
          prescriptionId={plan.id}
          replacing={{
            id: swapping.id,
            drill_name: swapping.drill_name,
            skill_category: swapping.skill_category,
          }}
          onCancel={() => setSwapping(null)}
          onSwapped={async () => { setSwapping(null); await loadDrills() }}
        />
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>
      )}

      {/* Two buttons, and no clock. The parent decides when it's done — an app
          counting down to day 21 is telling them it knows better than they do
          whether their kid has got it, and it doesn't. */}
      <div className="space-y-2 pt-2">
        <button
          onClick={logSession}
          disabled={logging || logged}
          className={`w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-colors ${
            logged
              ? 'bg-green-600 text-white'
              : 'bg-gray-900 text-white active:bg-gray-800'
          } disabled:opacity-70`}
        >
          {logging ? <Loader2 className="animate-spin" size={19} /> : <Check size={19} />}
          {logged ? 'Logged for today' : 'We worked on this today'}
        </button>

        <button
          onClick={closeOut}
          disabled={closing}
          className="w-full py-4 rounded-xl border-2 border-green-600 text-green-700 text-lg font-bold active:bg-green-50 disabled:opacity-50"
        >
          {closing ? 'Closing…' : "He's got it — close this plan"}
        </button>

        <Link
          href={`/dashboard/chat?teamId=${teamId || ''}&prescriptionId=${plan.id}`}
          className="w-full py-3 rounded-xl text-gray-700 font-medium flex items-center justify-center gap-2"
        >
          <Sparkles size={16} /> Ask about this plan
        </Link>

        {/* Last, quiet, and worded so it cannot be mistaken for the green
            button above it. Closing means it worked; this means it should not
            exist. */}
        <button
          onClick={async () => {
            const ok = confirm(
              `Delete this plan for ${plan.subjectName}?\n\n` +
              `Sessions you've already logged are kept — only the plan itself goes. ` +
              `If it worked, close it out instead so the result is on the record.`
            )
            if (!ok) return
            setRemoving(true)
            try {
              const res = await fetch(
                `/api/prescribe/commit?coachId=${coachId}&prescriptionId=${plan.id}`,
                { method: 'DELETE' }
              )
              if (!res.ok) {
                const d = await res.json()
                throw new Error(d.error || 'Could not delete that')
              }
              onClosedOut()
            } catch (e: any) {
              setError(e.message)
              setRemoving(false)
            }
          }}
          disabled={removing}
          className="w-full py-3 rounded-xl text-red-600 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Trash2 size={16} /> {removing ? 'Deleting…' : 'Delete this plan'}
        </button>
      </div>
    </div>
  )
}


// One drill, everywhere a drill is shown.
//
// The dose and the marker come straight off the library row. They were being
// fetched and dropped, which is how "3 sets of 8, and he has it when the front
// elbow stops flaring" became a card with a name and a video on it.
function DrillCard({
  drill: d, n, onSwap,
}: {
  drill: Drill
  n: number
  onSwap: () => void
}) {
  const dose = [d.reps_guidance, d.frequency_guidance].filter(Boolean).join(' · ')

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full bg-gray-900 text-white text-sm font-bold flex items-center justify-center">
          {n}
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-gray-900">{d.drill_name}</h4>

          {/* Above the description, because it is the thing a parent standing
              in the backyard actually needs off this card. */}
          {dose && (
            <p className="text-sm font-semibold text-gray-900 mt-1">{dose}</p>
          )}

          {d.description && (
            <p className="text-[15px] text-gray-700 mt-1.5 leading-relaxed">{d.description}</p>
          )}
          {d.ai_coaching_notes && (
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-sm text-blue-900 leading-relaxed">{d.ai_coaching_notes}</p>
            </div>
          )}
          {d.equipment_needed && d.equipment_needed.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              You need: {d.equipment_needed.join(', ')}
            </p>
          )}

          {/* The video plays here rather than throwing the coach into the
              YouTube app, which loses the plan and usually the page.
              Thumbnail until tapped — see DrillVideo. */}
          {(d.youtube_url || d.youtube_video_id) && (
            <div className="mt-3">
              <DrillVideo
                drillName={d.drill_name}
                youtubeVideoId={d.youtube_video_id || undefined}
                youtubeUrl={d.youtube_url || undefined}
                startSeconds={d.youtube_start_seconds ?? undefined}
                autoExpand
              />
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {/* One drill, not the whole set. A coach who dislikes one drill
                wants that drill changed, not a new plan. */}
            <button
              onClick={onSwap}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-bold text-sm active:bg-gray-100"
            >
              <Repeat size={15} /> Swap it
            </button>
            {(d.youtube_url || d.youtube_video_id) && (
              <a
                href={d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-500 underline"
              >
                Open the video
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
