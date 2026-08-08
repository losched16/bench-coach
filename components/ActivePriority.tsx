'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Target, Check, Loader2, ArrowRight, CalendarCheck } from 'lucide-react'
import { todayStr } from '@/lib/entries'
import { focusAreaLabel, focusAreaChip } from '@/lib/focusAreas'

// The active priority, with the log button attached to it.
//
// This is the load-bearing surface of the whole loop, and the reason is
// unglamorous: the check-in can only be as good as the adherence data, and
// nobody navigates two levels into a form to record "did the tee drill for ten
// minutes". So the button lives where they already are, it saves on the first
// tap, and the optional note comes after — never before.
//
// Three states, in the order a coach meets them:
//   holding            → "here's what we're working on. Did you work on it?"
//   due, no evidence   → still the log button. A check-in with nothing to read
//                        can only say "I can't tell", and asking someone to sit
//                        through that teaches them to ignore the feature.
//   due, has evidence  → the check-in CTA takes over.

export interface ActivePriorityItem {
  id: string
  scope: 'player' | 'team'
  focusArea?: string | null
  subjectName: string
  priority: string | null
  daysElapsed: number
  due: 'holding' | 'due' | 'overdue'
  adherence: { logged: number; expected: number }
  lastSessionOn?: string | null
  hasEvidence?: boolean
  playerId?: string | null
  teamId?: string | null
}

const HOLD_DAYS = 21

export function ActivePriority({
  item,
  coachId,
  teamId,
  onLogged,
  onCheckIn,
  busy,
}: {
  item: ActivePriorityItem
  coachId: string
  teamId: string | null
  onLogged?: () => void
  // Supplied by the Check-In page, which runs the read in place rather than
  // navigating to itself. Omitted on the dashboard, where it's a link.
  onCheckIn?: (prescriptionId: string) => void
  busy?: boolean
}) {
  const [logging, setLogging] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyNoted, setAlreadyNoted] = useState(false)

  const today = todayStr()
  const alreadyToday = item.lastSessionOn === today
  const readyToCheckIn = item.due !== 'holding' && item.hasEvidence
  const pct = Math.min(100, Math.round((item.daysElapsed / HOLD_DAYS) * 100))

  // `deliberate` is the "Log another" path: a real second session in one day
  // — a morning and an evening in the cage — which must stay possible. The
  // primary button is the accidental one, so only it is deduplicated.
  const logSession = async (deliberate = false) => {
    if (logging) return
    // The disabled state only covers the in-flight window. Tapping, going
    // back, and tapping again would otherwise write a second session for the
    // same day — and adherence is the number that decides whether a null
    // result means change the drill or shrink the ask.
    if (!deliberate && entryId) return
    setLogging(true)
    setError(null)
    try {
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId,
          teamId: item.teamId || teamId,
          playerId: item.scope === 'player' ? item.playerId : null,
          entryType: 'home_session',
          occurredOn: today,
          prescriptionId: item.id,
          title: 'Worked the priority',
          // Marks this as the one-tap path, which is deduplicated per day.
          // The full Log an Entry form is not — two real sessions in a day
          // is legitimate and must still be loggable.
          quickLog: !deliberate,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEntryId(data.entry?.id || null)
      // A second tap returns the first entry instead of writing another. The
      // coach meant "record that we ran it", and it is recorded — so this
      // reads as success, not as an error.
      if (data.alreadyLogged) setAlreadyNoted(true)
      onLogged?.()
    } catch (e: any) {
      setError(e.message || 'Could not save that. Try again.')
    } finally {
      setLogging(false)
    }
  }

  const saveNote = async () => {
    if (!entryId || !note.trim()) return
    try {
      await fetch('/api/log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId,
          entryId,
          notes: [{ prompt_key: 'how_it_went', body: note }],
        }),
      })
      setNoteSaved(true)
      onLogged?.()
    } catch {
      setError('Saved the session, but the note did not stick. Try again.')
    }
  }

  return (
    <div className={`bg-white rounded-lg shadow p-5 border-l-4 ${
      readyToCheckIn ? 'border-amber-400' : 'border-red-500'
    }`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {readyToCheckIn
          ? <CalendarCheck className="text-amber-600" size={20} />
          : <Target className="text-red-600" size={20} />}
        <h3 className="font-semibold text-gray-900">
          {readyToCheckIn ? 'Ready to review' : 'Working on'}
        </h3>
        {/* The area is the unit. Several run at once and a coach needs to see
            at a glance which one this card is. */}
        <span className={`text-xs px-2 py-0.5 rounded-full ${focusAreaChip(item.focusArea)}`}>
          {focusAreaLabel(item.focusArea)}
        </span>
        <span className="text-xs text-gray-500 ml-auto">
          Day {item.daysElapsed} of {HOLD_DAYS}
        </span>
      </div>

      <p className="text-sm text-gray-500">{item.subjectName}</p>
      <p className="text-[15px] text-gray-900 mt-1 leading-relaxed">{item.priority}</p>

      {/* Progress through the hold window — the point is that it's a window,
          not a task list. Three weeks is how long this takes. */}
      <div className="mt-4 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${readyToCheckIn ? 'bg-amber-400' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1.5">
        {item.adherence.logged === 0
          ? 'No sessions logged on this yet'
          : `${item.adherence.logged} ${item.adherence.logged === 1 ? 'session' : 'sessions'} worked on this so far`}
      </p>

      {readyToCheckIn ? (
        <>
          {onCheckIn ? (
            <button
              onClick={() => onCheckIn(item.id)}
              disabled={busy}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : null}
              See if it&apos;s working
            </button>
          ) : (
            <Link
              href={`/dashboard?teamId=${teamId}&prescriptionId=${item.id}`}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium"
            >
              See if it&apos;s working
              <ArrowRight size={16} />
            </Link>
          )}
          {/* Say what pressing it will do. "See whether it moved" told a coach
              nothing about what they were about to get. */}
          <p className="text-xs text-gray-500 mt-2 text-center leading-relaxed">
            Reads everything logged over the last {item.daysElapsed} days — sessions, games,
            measurements — and tells you whether it improved and what to do next.
          </p>
        </>
      ) : (
        <div className="mt-4">
          {entryId || alreadyToday ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
                <Check size={16} />
                <span>
                  {alreadyNoted
                    ? 'Today was already counted.'
                    : 'Counted. That session is now part of the check-in.'}
                </span>
                {entryId && (
                  <button
                    onClick={() => logSession(true)}
                    disabled={logging}
                    className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-50"
                  >
                    Log another
                  </button>
                )}
              </div>

              {/* Optional, and visibly optional. The session is already saved. */}
              {entryId && !noteSaved && (
                <div>
                  <p className="text-xs text-gray-600 mb-1.5">
                    What did you see? Optional — but it&apos;s the difference between a check-in
                    that names the cause and one that says &ldquo;can&apos;t tell yet&rdquo;.
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. first 10 were ugly, then it clicked — he was staying back on the last round"
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                  />
                  {note.trim() && (
                    <button
                      onClick={saveNote}
                      className="mt-2 px-4 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                    >
                      Add note
                    </button>
                  )}
                </div>
              )}
              {noteSaved && (
                <p className="text-xs text-gray-500">
                  Saved. Notes like that are what let the check-in say something specific instead of
                  &ldquo;not enough to tell&rdquo;.
                </p>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={() => logSession()}
                disabled={logging || alreadyToday}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
              >
                {logging ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                {alreadyToday ? 'Logged for today' : 'We worked on this today'}
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center leading-relaxed">
                {alreadyToday
                  ? 'Today is counted. If you went out a second time, use “Log another” above.'
                  : <>
                      Tap this any time you put work into it — ten minutes in the driveway counts.
                      It&apos;s how the check-in can tell a drill that isn&apos;t working from a plan
                      that was too big for your week.
                    </>}
              </p>
            </>
          )}
        </div>
      )}

      {/* Due, but nothing to read. Say so honestly and point at the fix. */}
      {item.due !== 'holding' && !item.hasEvidence && (
        <p className="text-xs text-gray-500 mt-3">
          This has been open {item.daysElapsed} days with nothing logged against it. A couple of sessions
          and the check-in has something real to tell you —{' '}
          {onCheckIn ? (
            <button onClick={() => onCheckIn(item.id)} className="underline">read it anyway</button>
          ) : (
            <Link
              href={`/dashboard?teamId=${teamId}&prescriptionId=${item.id}`}
              className="underline"
            >
              read it anyway
            </Link>
          )}.
        </p>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
