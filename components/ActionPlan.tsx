'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Clock, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

// The plan, as something you do rather than something you read.
//
// The development plan already wrote real sessions. The problem was that it
// arrived as three weeks of prose under three headings: nothing to tick,
// nothing that knew where you were, and a check-in three weeks later that could
// only see that SOMETHING was logged, never which session.
//
// This is the same sessions, as a checklist. The prose is still there — "how to
// tell it's working" and "when it goes sideways" are the most useful paragraphs
// in the plan and would be ruined by being turned into tasks — it just moved
// behind a disclosure, because you read it once and run this every Tuesday.

export interface PlanBlock { minutes: number | null; what: string; cue: string | null }
export interface PlanSession {
  key: string
  week: number
  title: string
  minutes: number | null
  blocks: PlanBlock[]
}

interface DoneRow { session_key: string; completed_on: string }

interface Props {
  coachId: string
  prescriptionId: string
  sessions: PlanSession[]
  // Contributors can tick; viewers cannot.
  canRecord?: boolean
  // 'Hitting', 'Pitching'. With several plans running at once, a checklist
  // headed "The plan" is the one thing a coach cannot act on.
  areaLabel?: string
}

export function ActionPlan({
  coachId, prescriptionId, sessions, canRecord = true, areaLabel,
}: Props) {
  const [done, setDone] = useState<DoneRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/plan-sessions?coachId=${coachId}&prescriptionId=${prescriptionId}`
      )
      const d = await res.json()
      setDone(d.done || [])
    } catch { /* the checklist still works, just without its ticks */ }
  }, [coachId, prescriptionId])

  useEffect(() => { load() }, [load])

  const isDone = (key: string) => done.some(d => d.session_key === key)

  const toggle = async (s: PlanSession) => {
    if (!canRecord) return
    const already = isDone(s.key)
    setBusy(s.key)
    setError(null)

    // Optimistic: this is a checkbox in a driveway, and waiting on a round trip
    // between reps is how a coach decides the app is slow.
    setDone(prev => already
      ? prev.filter(d => d.session_key !== s.key)
      : [...prev, { session_key: s.key, completed_on: new Date().toISOString().split('T')[0] }])

    try {
      const res = already
        ? await fetch(
            `/api/plan-sessions?prescriptionId=${prescriptionId}&sessionKey=${encodeURIComponent(s.key)}`,
            { method: 'DELETE' }
          )
        : await fetch('/api/plan-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              coachId, prescriptionId, sessionKey: s.key, title: s.title, minutes: s.minutes,
            }),
          })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not save that')
      }
      await load()
    } catch (e: any) {
      setError(e.message)
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (sessions.length === 0) return null

  const completed = sessions.filter(s => isDone(s.key)).length
  const byWeek = sessions.reduce<Record<number, PlanSession[]>>((acc, s) => {
    ;(acc[s.week] ||= []).push(s)
    return acc
  }, {})

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-900">
          {areaLabel ? `${areaLabel} plan` : 'The plan'}
        </h4>
        <span className="text-xs text-gray-500 tabular-nums">
          {completed} of {sessions.length} done
        </span>
      </div>

      {/* Progress, shown rather than described. */}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 transition-all"
          style={{ width: `${sessions.length ? (completed / sessions.length) * 100 : 0}%` }}
        />
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>
      )}

      {Object.keys(byWeek).map(Number).sort((a, b) => a - b).map(week => (
        <div key={week} className="space-y-1.5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide pt-1">
            Week {week}
          </div>
          {byWeek[week].map(s => {
            const ticked = isDone(s.key)
            const open = openKey === s.key
            return (
              <div
                key={s.key}
                className={`rounded-lg border transition-colors ${
                  ticked ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-2 p-2.5">
                  <button
                    onClick={() => toggle(s)}
                    disabled={!canRecord || busy === s.key}
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      ticked
                        ? 'bg-green-600 border-green-600 text-white'
                        : 'border-gray-300 text-transparent hover:border-gray-400'
                    } ${canRecord ? '' : 'opacity-50 cursor-default'}`}
                    aria-label={ticked ? `Mark ${s.title} not done` : `Mark ${s.title} done`}
                  >
                    {busy === s.key
                      ? <Loader2 size={13} className="animate-spin text-gray-500" />
                      : <Check size={14} />}
                  </button>

                  <button
                    onClick={() => setOpenKey(open ? null : s.key)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className={`text-sm font-medium ${ticked ? 'text-green-900 line-through' : 'text-gray-900'}`}>
                      {s.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      {s.minutes && (
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {s.minutes} min
                        </span>
                      )}
                      {s.blocks.length > 0 && (
                        <span>{s.blocks.length} {s.blocks.length === 1 ? 'part' : 'parts'}</span>
                      )}
                    </div>
                  </button>

                  {s.blocks.length > 0 && (
                    <button
                      onClick={() => setOpenKey(open ? null : s.key)}
                      className="shrink-0 p-1 text-gray-400"
                      aria-label={open ? 'Hide the steps' : 'Show the steps'}
                    >
                      {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  )}
                </div>

                {open && s.blocks.length > 0 && (
                  <div className="px-2.5 pb-2.5 pl-10 space-y-2">
                    {s.blocks.map((b, i) => (
                      <div key={i} className="text-sm">
                        <div className="text-gray-800">
                          {b.minutes && (
                            <span className="text-xs font-medium text-gray-500 mr-1.5">
                              {b.minutes} min
                            </span>
                          )}
                          {b.what}
                        </div>
                        {b.cue && (
                          <div className="text-xs text-blue-700 mt-0.5">Cue: {b.cue}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
