'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  CalendarCheck, Loader2, AlertCircle, Target, History, Search,
  CheckCircle2, RotateCcw, XCircle, Sparkles, ChevronRight,
} from 'lucide-react'
import { usePageView, useTracker } from '@/lib/tracking'
import { AnalysisProse } from '@/components/AnalysisProse'
import { splitSections } from '@/lib/analysis'
import { VERDICT_SENTINEL, visibleMarkdown, AdherenceRead, DueState, Verdict, VerdictStatus } from '@/lib/checkin'

interface OpenPrescription {
  id: string
  scope: 'player' | 'team'
  subjectName: string
  priority: string | null
  successCriteria: string | null
  issuedAt: string
  reviewDueAt: string | null
  daysElapsed: number
  due: DueState
  adherence: AdherenceRead
}

interface Section { key: string; heading: string; body: string }

const SECTION_META: Record<string, { icon: any; accent: string }> = {
  where_this_started: { icon: History, accent: 'text-slate-600' },
  what_s_happened_since: { icon: Search, accent: 'text-blue-600' },
  the_read: { icon: Target, accent: 'text-red-600' },
  next_three_weeks: { icon: CalendarCheck, accent: 'text-green-600' },
}

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

function dueLabel(p: OpenPrescription): { text: string; className: string } {
  if (p.due === 'overdue') return { text: 'Overdue', className: 'bg-red-100 text-red-700' }
  if (p.due === 'due') return { text: 'Ready to check in', className: 'bg-amber-100 text-amber-800' }
  const daysLeft = p.reviewDueAt
    ? Math.max(0, Math.ceil((new Date(p.reviewDueAt).getTime() - Date.now()) / 86_400_000))
    : null
  return {
    text: daysLeft !== null ? `${daysLeft} days to go` : 'In progress',
    className: 'bg-gray-100 text-gray-600',
  }
}

function CheckinContent() {
  usePageView('checkin')
  const track = useTracker()
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const focusId = searchParams.get('prescriptionId')
  const supabase = createSupabaseComponentClient()

  const [coachId, setCoachId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [open, setOpen] = useState<OpenPrescription[]>([])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [sections, setSections] = useState<Section[] | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checkinId, setCheckinId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolvedAs, setResolvedAs] = useState<VerdictStatus | null>(null)

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
    if (data.needsMigration) setNeedsMigration(true)
    setOpen(data.prescriptions || [])
  }

  // Deep link from the dashboard card / email lands straight on the read
  useEffect(() => {
    if (focusId && coachId && !activeId && open.some(p => p.id === focusId)) {
      run(focusId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, coachId, open])

  const run = async (prescriptionId: string) => {
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
        body: JSON.stringify({ coachId, prescriptionId }),
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
  const dueList = open.filter(p => p.due !== 'holding')
  const holdingList = open.filter(p => p.due === 'holding')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2">
          <CalendarCheck className="text-red-600" size={26} />
          <h1 className="text-2xl font-bold text-gray-900">Check-In</h1>
        </div>
        <p className="text-gray-600 mt-1">
          We said in advance what improvement would look like. This goes back and tells you whether it happened.
        </p>
      </div>

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm text-amber-800">
            The check-in tables aren&apos;t set up yet. Run{' '}
            <code className="bg-amber-100 px-1 rounded">migrations/014_checkins.sql</code> in your Supabase
            SQL editor, then refresh.
          </div>
        </div>
      )}

      {open.length === 0 && !needsMigration && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <Target className="mx-auto text-gray-300 mb-3" size={32} />
          <p className="text-gray-800 font-medium">Nothing to check in on yet</p>
          <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
            Once you&apos;ve got a priority from{' '}
            <a href={`/dashboard/prescribe?teamId=${teamId}`} className="text-red-600 underline">What to Work On</a>,
            it shows up here three weeks later with a read on whether it moved.
          </p>
        </div>
      )}

      {/* Due first — this is what the page is for */}
      {dueList.length > 0 && (
        <div className="space-y-3">
          {dueList.map(p => {
            const badge = dueLabel(p)
            const isActive = p.id === activeId
            return (
              <div
                key={p.id}
                className={`bg-white rounded-lg shadow-sm border p-5 ${
                  isActive ? 'border-red-300 ring-1 ring-red-100' : 'border-amber-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{p.subjectName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badge.className}`}>{badge.text}</span>
                      <span className="text-xs text-gray-500">{p.daysElapsed} days in</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2 line-clamp-3">{p.priority}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      {p.adherence.logged} of about {p.adherence.expected} sessions logged
                    </p>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => run(p.id)}
                      disabled={running}
                      className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors text-sm"
                    >
                      {running ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                      Check in
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {running && !sections?.length && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Loader2 className="animate-spin mx-auto text-red-600 mb-3" size={24} />
          <p className="text-gray-700 font-medium">Comparing it against what we said to watch for</p>
          <p className="text-sm text-gray-500 mt-1">Usually 15–30 seconds.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      {/* The read */}
      {sections && sections.length > 0 && (
        <div className="space-y-4">
          {sections.map((section, idx) => {
            const meta = SECTION_META[section.key] || { icon: ChevronRight, accent: 'text-gray-600' }
            const Icon = meta.icon
            const isRead = section.key === 'the_read'
            return (
              <div
                key={section.key}
                className={`bg-white rounded-lg shadow-sm border p-5 ${
                  isRead ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={meta.accent} size={18} />
                  <h2 className="font-semibold text-gray-900">{section.heading}</h2>
                </div>
                <AnalysisProse body={section.body} />
                {streaming && idx === sections.length - 1 && (
                  <span className="inline-block w-2 h-4 bg-red-500 animate-pulse align-middle ml-0.5 rounded-sm" />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Disposition — the AI recommends, the coach decides */}
      {verdict && !streaming && activePrescription && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          {resolvedAs ? (
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="text-green-600 flex-shrink-0 mt-0.5" size={18} />
              <span>
                Recorded.{' '}
                {resolvedAs === 'active'
                  ? "We'll hold this priority and come back in another three weeks."
                  : resolvedAs === 'resolved'
                    ? 'Closed out. Head to What to Work On when you want the next one.'
                    : resolvedAs === 'stalled'
                      ? 'Marked as stalled — go to What to Work On and we\'ll build the next plan knowing this one did not take.'
                      : 'Set aside. It stays in the history so we don\'t suggest it again blindly.'}
              </span>
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

      {/* Still holding — visible so the loop feels alive between check-ins */}
      {holdingList.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-1">In progress</h2>
          <p className="text-xs text-gray-500 mb-3">
            We hold a priority for three weeks rather than changing it every time new data lands — that&apos;s
            how long it takes to move something at this age.
          </p>
          <div className="space-y-3">
            {holdingList.map(p => (
              <div key={p.id} className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 text-sm">{p.subjectName}</div>
                  <div className="text-sm text-gray-600 line-clamp-2">{p.priority}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {p.adherence.logged} of about {p.adherence.expected} sessions logged ·{' '}
                    <a href={`/dashboard/log?teamId=${teamId}`} className="text-red-600 underline">log one</a>
                  </div>
                </div>
                <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${dueLabel(p).className}`}>
                  {dueLabel(p).text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CheckinPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    }>
      <CheckinContent />
    </Suspense>
  )
}
