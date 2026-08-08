'use client'

import { useEffect, useRef, useState } from 'react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  CalendarCheck, Loader2, AlertCircle, Target, History, Search,
  CheckCircle2, RotateCcw, XCircle, ChevronRight, ListChecks, MessageSquarePlus, ChevronDown,
  ClipboardList,
} from 'lucide-react'
import { useTracker } from '@/lib/tracking'
import { PrescriptionSections } from './PrescriptionSections'
import { ActivePriority } from './ActivePriority'
import { PriorityDrills } from './PriorityDrills'
import { DevelopmentPlan } from './DevelopmentPlan'
import { splitSections } from '@/lib/analysis'
import { focusAreaRank, focusAreaLabel, focusAreaChip, practiceFocusFor } from '@/lib/focusAreas'
import { VERDICT_SENTINEL, visibleMarkdown, AdherenceRead, DueState, Verdict, VerdictStatus } from '@/lib/checkin'

interface OpenPrescription {
  id: string
  scope: 'player' | 'team'
  focusArea: string | null
  subjectName: string
  priority: string | null
  successCriteria: string | null
  issuedAt: string
  reviewDueAt: string | null
  daysElapsed: number
  due: DueState
  adherence: AdherenceRead
  lastSessionOn: string | null
  evidenceCount: number
  hasEvidence: boolean
  playerId: string | null
  teamId: string | null
}

interface Section { key: string; heading: string; body: string }


// The four dispositions, in the order a coach is most likely to want them.
// Wording matters here: these are the words that go into the record, and
// "give it longer" is a legitimate answer at three weeks, not a cop-out.
const ACTIONS: Array<{ status: VerdictStatus; label: string; icon: any; className: string; hint: string }> = [
  {
    status: 'resolved', label: 'It moved — close it', icon: CheckCircle2,
    className: 'bg-green-600 hover:bg-green-700 text-white',
    hint: 'The criteria we set were met.',
  },
  {
    status: 'active', label: 'Give it longer', icon: RotateCcw,
    className: 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-300',
    hint: 'Same priority, another three weeks.',
  },
  {
    status: 'stalled', label: 'Change the plan', icon: Target,
    className: 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-300',
    hint: 'Time and reps went in and it did not move.',
  },
  {
    status: 'abandoned', label: 'Not the priority anymore', icon: XCircle,
    className: 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-300',
    hint: 'Season ended, position changed, something else took over.',
  },
]

interface Props {
  teamId: string | null
  // Deep link from the weekly digest or a priority card: land straight on the
  // read for one priority rather than making the coach find it again.
  focusId?: string | null
}

export function PrioritiesBoard({ teamId, focusId = null }: Props) {
  const track = useTracker()
  const supabase = createSupabaseComponentClient()

  const [coachId, setCoachId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState<OpenPrescription[]>([])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [sections, setSections] = useState<Section[] | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checkinId, setCheckinId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolvedAs, setResolvedAs] = useState<VerdictStatus | null>(null)
  // Which priority has its drills-and-updates panel open, and what the coach
  // has typed into it.
  // Which card is open. One is open from the start: the drills are what a
  // coach came to see before a session, and hiding all of them behind a tap
  // charged a click for the most common thing on the screen. One expanded is
  // not a wall; all of them would be.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const autoExpanded = useRef(false)
  const [updateDraft, setUpdateDraft] = useState('')

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: coach } = await supabase
        .from('coaches').select('id').eq('user_id', user.id).single() as { data: { id: string } | null }
      if (!coach) { setLoading(false); return }
      setCoachId(coach.id)
      await load(coach.id)
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const load = async (cid: string) => {
    const params = new URLSearchParams({ coachId: cid })
    if (teamId) params.set('teamId', teamId)
    const res = await fetch(`/api/checkin?${params}`)
    const data = await res.json()
    setNeedsMigration(!!data.needsMigration)
    setMigrationMessage(data.migrationMessage || null)
    setLoadError(data.needsMigration ? null : (data.error || null))
    setOpen(data.prescriptions || [])
  }

  useEffect(() => {
    if (autoExpanded.current || open.length === 0) return
    autoExpanded.current = true
    // A deep link names the one they came for; otherwise the list is already
    // sorted with the most actionable first.
    const rank = (p: OpenPrescription) => (p.due !== 'holding' ? 0 : 1)
    const wanted = focusId && open.some(p => p.id === focusId)
      ? focusId
      : [...open].sort(
          (a, b) => rank(a) - rank(b) || focusAreaRank(a.focusArea) - focusAreaRank(b.focusArea)
        )[0]?.id
    if (wanted) setExpandedId(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusId])

  // Deep link from the dashboard card / email lands straight on the read
  useEffect(() => {
    if (focusId && coachId && !activeId && open.some(p => p.id === focusId)) {
      run(focusId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, coachId, open])

  // coachUpdate is set when the coach asked for this read instead of waiting
  // for the clock. It goes into the evidence bundle and outranks everything
  // else in it — they were at the field.
  const run = async (prescriptionId: string, coachUpdate?: string) => {
    if (!coachId) return
    setActiveId(prescriptionId)
    setRunning(true)
    setSections(null)
    setVerdict(null)
    setCheckinId(null)
    setResolvedAs(null)
    setError(null)

    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, prescriptionId, coachUpdate }),
      })

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const data = await res.json()
        setError(data.error || 'Could not run the check-in.')
        return
      }
      if (!res.body) throw new Error('No response from the server')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const at = buffer.indexOf(VERDICT_SENTINEL)
        setSections(splitSections(visibleMarkdown(buffer)))
        setStreaming(at === -1)

        if (at !== -1) {
          try {
            const meta = JSON.parse(buffer.slice(at + VERDICT_SENTINEL.length))
            if (meta.error) setError(meta.error)
            if (meta.verdict) setVerdict(meta.verdict)
            if (meta.checkinId) setCheckinId(meta.checkinId)
            setStreaming(false)
            if (!meta.error) {
              track('checkin_generated', {
                verdict: meta.verdict?.status || null,
                sessions_logged: meta.adherence?.logged ?? null,
                days_elapsed: open.find(p => p.id === prescriptionId)?.daysElapsed ?? null,
              })
            }
          } catch {
            // tail not complete yet — the next chunk finishes it
          }
        }
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setRunning(false)
      setStreaming(false)
    }
  }

  const resolve = async (status: VerdictStatus) => {
    if (!coachId || !activeId) return
    setResolvedAs(status)
    try {
      await fetch('/api/checkin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId,
          prescriptionId: activeId,
          checkinId,
          status,
          outcomeNote: verdict?.outcome_note || null,
        }),
      })
      track('checkin_resolved', { status, agreed_with_ai: verdict?.status === status })
      await load(coachId)
    } catch {
      setResolvedAs(null)
    }
  }

  const activePrescription = open.find(p => p.id === activeId) || null
  const byArea = (a: OpenPrescription, b: OpenPrescription) =>
    focusAreaRank(a.focusArea) - focusAreaRank(b.focusArea)
  const dueList = open.filter(p => p.due !== 'holding').sort(byArea)
  const holdingList = open.filter(p => p.due === 'holding').sort(byArea)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }


  // Everything you can do to a priority that is already running: see the
  // drills it prescribed, swap them when they aren't landing, or say what
  // you're actually seeing and have it re-read on the spot.
  const renderPriority = (p: OpenPrescription, opts: { due: boolean }) => {
    const isOpen = expandedId === p.id
    return (
      <div key={p.id}>
        <ActivePriority
          item={p}
          coachId={coachId!}
          teamId={teamId}
          busy={opts.due ? running : undefined}
          onCheckIn={opts.due ? run : undefined}
          onLogged={() => load(coachId!)}
        />

        <div className="mt-1.5 bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => { setExpandedId(isOpen ? null : p.id); setUpdateDraft('') }}
            className="w-full px-4 py-2.5 flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
          >
            <ListChecks size={15} className="text-gray-400" />
            Drills and updates
            <ChevronDown
              size={15}
              className={`ml-auto text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isOpen && (
            <div className="px-4 pb-4 pt-1 space-y-4 border-t border-gray-100">
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  What to run
                </h4>
                <PriorityDrills
                  prescriptionId={p.id}
                  coachId={coachId!}
                  onSwapped={() => load(coachId!)}
                />
              </div>

              {/* Turning the priority into something you can actually run.
                  A team priority becomes a practice; a player's becomes three
                  weeks of sessions. */}
              <div className="pt-3 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {p.scope === 'team' ? 'Run it at practice' : 'The plan'}
                </h4>
                {p.scope === 'team' ? (
                  <div>
                    <a
                      href={`/dashboard/practice?teamId=${teamId || ''}${
                        practiceFocusFor(p.focusArea) ? `&focus=${practiceFocusFor(p.focusArea)}` : ''
                      }`}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800"
                    >
                      <ClipboardList size={15} />
                      Build a practice around this
                    </a>
                    <p className="text-xs text-gray-500 mt-2">
                      Opens the practice builder with {focusAreaLabel(p.focusArea).toLowerCase()}{' '}
                      preselected. It already reads your active priorities, so this one shows up as a block.
                    </p>
                  </div>
                ) : (
                  <DevelopmentPlan
                    prescriptionId={p.id}
                    coachId={coachId!}
                    subjectName={p.subjectName}
                  />
                )}
              </div>

              <div className="pt-3 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Something changed?
                </h4>
                <p className="text-xs text-gray-600 mb-2">
                  Tell it what you&apos;re seeing and it re-reads now instead of waiting for the
                  three weeks. What you say outweighs the box scores — you were there.
                </p>
                <textarea
                  value={isOpen ? updateDraft : ''}
                  onChange={e => setUpdateDraft(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="e.g. He's staying back now but he's pulling everything foul, or the lesson coach says it's his front shoulder, not timing"
                />
                <button
                  onClick={() => { run(p.id, updateDraft.trim() || undefined); setExpandedId(null) }}
                  disabled={running || !updateDraft.trim()}
                  className="mt-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {running ? <Loader2 className="animate-spin" size={14} /> : <MessageSquarePlus size={14} />}
                  {running ? 'Reading…' : 'Send the update'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm text-amber-800">
            {migrationMessage
              ? migrationMessage
              : <>Your database is missing something this page needs. The files in{' '}
                 <code className="bg-amber-100 px-1 rounded">/migrations</code> are safe to re-run.</>}
          </div>
        </div>
      )}

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
          <div className="text-sm text-red-800">
            Couldn&apos;t load your priorities: {loadError}
          </div>
        </div>
      )}

      {open.length === 0 && !needsMigration && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <Target className="mx-auto text-gray-300 mb-3" size={32} />
          <p className="text-gray-800 font-medium">Nothing to check in on yet</p>
          <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
            Ask <a href={`/dashboard/chat?teamId=${teamId}`} className="text-red-600 underline">CoachAI</a> about
            something you want to fix, then hit &ldquo;Make this the priority&rdquo; on the answer. It shows
            up here with its drills, and after three weeks you can see if it&apos;s working.
          </p>
        </div>
      )}

      {/* Due first — this is what the page is for. Same card as the dashboard,
          so the log button is here too: a priority that's due with nothing
          logged needs a session far more than it needs a verdict. */}
      {coachId && dueList.length > 0 && (
        <div className="space-y-4">
          {dueList
            .filter(p => p.id !== activeId || !sections)
            .map(p => renderPriority(p, { due: true }))}
        </div>
      )}

      {running && !sections?.length && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Loader2 className="animate-spin mx-auto text-red-600 mb-3" size={24} />
          <p className="text-gray-700 font-medium">Reading what&apos;s happened since you started this</p>
          <p className="text-sm text-gray-500 mt-1">Usually 15–30 seconds.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      {/* The read */}
      {sections && sections.length > 0 && (
        <div className="space-y-4">
          {/* Which priority this read is about — with several running in
              parallel, an unlabelled wall of prose is ambiguous. */}
          {activePrescription && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{activePrescription.subjectName}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${focusAreaChip(activePrescription.focusArea)}`}>
                {focusAreaLabel(activePrescription.focusArea)}
              </span>
              <span className="text-xs text-gray-500">
                {activePrescription.daysElapsed} days in ·{' '}
                {activePrescription.adherence.logged} sessions logged
              </span>
            </div>
          )}
          <PrescriptionSections sections={sections} streaming={streaming} />
        </div>
      )}

      {/* Disposition — the AI recommends, the coach decides */}
      {verdict && !streaming && activePrescription && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          {resolvedAs ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <CheckCircle2 className="text-green-600 flex-shrink-0 mt-0.5" size={18} />
                <span>
                  Recorded.{' '}
                  {resolvedAs === 'active'
                    ? "We'll hold this priority and come back in another three weeks."
                    : resolvedAs === 'resolved'
                      ? 'Closed out — it stays in the history, so the next read knows this one worked.'
                      : resolvedAs === 'stalled'
                        ? 'Marked as stalled. The next read will know this one did not take, which is worth as much as a win.'
                        : "Set aside. It stays in the history so we don't suggest it again blindly."}
                </span>
              </div>

              {/* "We're done with this, here's the next issue" — the moment a
                  coach knows exactly what they want to work on next, and until
                  now the copy just told them to go find another screen. */}
              {resolvedAs !== 'active' && activePrescription && (
                <a
                  href={`/dashboard/chat?teamId=${teamId || ''}${
                    activePrescription.playerId ? `&playerId=${activePrescription.playerId}` : ''
                  }`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                >
                  <MessageSquarePlus size={15} />
                  What&apos;s next for {activePrescription.subjectName}?
                </a>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-1">
                Our read: <span className="font-medium text-gray-900">{verdict.outcome_note}</span>
              </p>
              <p className="text-xs text-gray-500 mb-4">
                You saw this player. If we got it wrong, pick the one that&apos;s actually true — it changes what we
                recommend next.
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                {ACTIONS.map(a => {
                  const Icon = a.icon
                  const recommended = verdict.status === a.status
                  return (
                    <button
                      key={a.status}
                      onClick={() => resolve(a.status)}
                      className={`flex items-start gap-2 px-4 py-3 rounded-lg text-left text-sm transition-colors ${
                        recommended ? a.className : 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-300'
                      }`}
                    >
                      <Icon size={16} className="flex-shrink-0 mt-0.5" />
                      <span>
                        <span className="font-medium block">{a.label}</span>
                        <span className={`text-xs ${recommended && a.status === 'resolved' ? 'text-green-50' : 'text-gray-500'}`}>
                          {recommended ? 'Recommended — ' : ''}{a.hint}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Still holding — visible so the loop feels alive between check-ins, and
          loggable from here so the three weeks actually accumulate something */}
      {coachId && holdingList.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">Still going</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              These stay put for three weeks rather than changing every time new data lands — that&apos;s
              roughly how long a real change takes at this age. Keep logging sessions and the review
              at the end will have something to go on.
            </p>
          </div>
          {holdingList.map(p => renderPriority(p, { due: false }))}
        </div>
      )}
    </div>
  )
}
