'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  Plus, Minus, Loader2, X, Users, Shield, Check, AlertTriangle, Clock, Trash2,
} from 'lucide-react'
import { usePageView, useTracker } from '@/lib/tracking'

// The pitch counter, with no game attached.
//
// Game Day makes you declare a game before you can count anything. That is the
// wrong shape for the moment this is used in: someone is standing at a fence,
// a kid is warming up, and they want to tap a name and go. Frequently the kid
// is on the other team, which Game Day cannot represent at all.
//
// Design rules, because this is used outdoors, one-handed, in sunlight:
//   - the count is the biggest thing on the screen
//   - the +1 target is enormous and cannot be missed
//   - every tap saves immediately; nothing depends on remembering to press Done
//   - the server owns the number, so a locked phone or a second device can't
//     silently roll the count backwards

interface Session {
  id: string
  subject_type: 'roster' | 'opponent' | 'adhoc'
  label: string
  pitches: number
  innings: number | null
  counted_on: string
  finished_at: string | null
  rule_set_id: string | null
  opponent_team_id: string | null
}

interface RosterPlayer { team_player_id: string; name: string; jersey_number: string | null }
interface RuleSet { id: string; sanctioning_body: string; age_group: string; daily_max: number | null }
interface Availability { status: string; explanation: string }

function CountContent() {
  usePageView('count')
  const track = useTracker()
  const teamId = useSearchParams().get('teamId')
  const supabase = createSupabaseComponentClient()

  const [coachId, setCoachId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [open, setOpen] = useState<Session[]>([])
  const [recent, setRecent] = useState<Session[]>([])
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [rules, setRules] = useState<RuleSet[]>([])

  const [active, setActive] = useState<Session | null>(null)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [starting, setStarting] = useState(false)
  const [showStart, setShowStart] = useState(false)
  const [resumedNote, setResumedNote] = useState<string | null>(null)
  const [adhocName, setAdhocName] = useState('')
  const [opponentTeamName, setOpponentTeamName] = useState('')
  const [ruleSetId, setRuleSetId] = useState('')

  // The count on screen updates instantly; the server call catches up. A
  // counter that lags behind your thumb is a counter you stop trusting.
  const [optimistic, setOptimistic] = useState<number | null>(null)
  const inflight = useRef(0)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: coach } = await supabase
        .from('coaches').select('id').eq('user_id', user.id).single() as { data: { id: string } | null }
      if (!coach) { setLoading(false); return }
      setCoachId(coach.id)

      const [, tps, ruleRows] = await Promise.all([
        load(coach.id),
        teamId
          ? supabase.from('team_players').select('id, player:players(name, jersey_number)').eq('team_id', teamId)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('pitch_count_rules')
          .select('id, sanctioning_body, age_group, daily_max')
          .order('sanctioning_body').order('age_group'),
      ])

      setRoster(((tps as any).data || []).map((tp: any) => ({
        team_player_id: tp.id,
        name: tp.player?.name || '',
        jersey_number: tp.player?.jersey_number ?? null,
      })).filter((r: RosterPlayer) => r.name))
      setRules(((ruleRows as any).data || []) as RuleSet[])
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const load = async (cid: string) => {
    const res = await fetch(`/api/pitch-count?coachId=${cid}`)
    const data = await res.json()
    if (data.needsMigration) setNeedsMigration(true)
    setOpen(data.open || [])
    setRecent(data.recent || [])
    return data
  }

  const start = async (payload: Record<string, any>) => {
    if (!coachId) return
    setStarting(true)
    try {
      const res = await fetch('/api/pitch-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, teamId, ruleSetId: ruleSetId || null, ...payload }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setActive(data.session)
      setOptimistic(data.session.pitches)
      setAvailability(null)
      setShowStart(false)
      setAdhocName('')
      // Picking a pitcher who already threw today continues their count rather
      // than opening a second one. Say so — a number that isn't zero when you
      // expected zero reads as a bug until it's explained.
      setResumedNote(
        data.resumed
          ? `Continuing ${data.session.label} — already at ${data.session.pitches} today.`
          : null
      )
      track(data.resumed ? 'pitch_count_resumed' : 'pitch_count_started', {
        subject_type: payload.subjectType,
        reopened: !!data.reopened,
      })
      await load(coachId)
    } catch (e: any) {
      alert(e.message || 'Could not start the counter')
    } finally {
      setStarting(false)
    }
  }

  const bump = async (delta: number) => {
    if (!active || !coachId) return
    const next = Math.max(0, (optimistic ?? active.pitches) + delta)
    setOptimistic(next)
    if (delta > 0 && navigator.vibrate) navigator.vibrate(25)

    inflight.current += 1
    try {
      const res = await fetch('/api/pitch-count', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, sessionId: active.id, delta }),
      })
      const data = await res.json()
      inflight.current -= 1
      // Only accept the server's number once every tap has landed, or a fast
      // thumb gets its count snapped backwards mid-sequence.
      if (data.session && inflight.current === 0) {
        setActive(data.session)
        setOptimistic(data.session.pitches)
      }
    } catch {
      inflight.current -= 1
    }
  }

  const finish = async () => {
    if (!active || !coachId) return
    const res = await fetch('/api/pitch-count', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId, sessionId: active.id, finish: true }),
    })
    const data = await res.json()
    track('pitch_count_finished', {
      pitches: data.session?.pitches, subject_type: data.session?.subject_type,
    })
    setAvailability(data.availability || null)
    setActive(data.session ? { ...data.session } : null)
    await load(coachId)
  }

  const resume = (s: Session) => {
    setActive(s)
    setOptimistic(s.pitches)
    setAvailability(null)
  }

  // Switching mid-game: park the current count and pick up another one without
  // leaving the counting screen. Nothing is finished — both stay open, and the
  // server holds the numbers, so a mis-tap costs a tap, not a count.
  const switchTo = async (s: Session) => {
    if (!coachId || s.id === active?.id) return
    // Take the server's number rather than the list's: the list was loaded
    // before the last few taps landed.
    const data = await load(coachId)
    const fresh = (data.open || []).find((o: Session) => o.id === s.id) || s
    setActive(fresh)
    setOptimistic(fresh.pitches)
    setAvailability(null)
    setResumedNote(null)
    track('pitch_count_switched', { subject_type: fresh.subject_type })
  }

  // Undo a Done. The count keeps accumulating on the same row and the same
  // date, so the day's total stays one number — which is the number the
  // pitch limit is actually about.
  const reopen = async (s: Session) => {
    if (!coachId) return
    const res = await fetch('/api/pitch-count', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId, sessionId: s.id, reopen: true }),
    })
    const data = await res.json()
    if (data.session) {
      setActive(data.session)
      setOptimistic(data.session.pitches)
      setAvailability(null)
      setResumedNote(`Back on ${data.session.label} — picking up at ${data.session.pitches}.`)
      track('pitch_count_reopened', { subject_type: data.session.subject_type })
      await load(coachId)
    }
  }

  const remove = async (id: string) => {
    if (!coachId) return
    await fetch(`/api/pitch-count?coachId=${coachId}&sessionId=${id}`, { method: 'DELETE' })
    if (active?.id === id) setActive(null)
    await load(coachId)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={32} /></div>
  }

  // ── Counting ─────────────────────────────────────────
  if (active && !active.finished_at) {
    const count = optimistic ?? active.pitches
    // Only this date's counters. Yesterday's open counter is a forgotten one,
    // not a pitcher who might come back out — showing it invites a mis-tap
    // that puts today's pitches on the wrong day.
    const todaysCounters = [
      active,
      ...open.filter(s => s.id !== active.id && s.counted_on === active.counted_on),
    ]
    const rule = rules.find(r => r.id === active.rule_set_id)
    const overDaily = rule?.daily_max ? count >= rule.daily_max : false
    const nearDaily = rule?.daily_max ? count >= rule.daily_max - 10 && !overDaily : false

    return (
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 truncate">{active.label}</div>
            <div className="text-xs text-gray-500">
              {active.subject_type === 'opponent' ? 'Opponent' : active.subject_type === 'roster' ? 'Your roster' : 'Quick count'}
              {rule ? ` · ${rule.sanctioning_body} ${rule.age_group}` : ''}
            </div>
          </div>
          <button
            onClick={() => setActive(null)}
            className="text-gray-400 hover:text-gray-600 p-2"
            aria-label="Back to all counters"
          >
            <X size={22} />
          </button>
        </div>

        {/* Everyone being counted today. Tap to switch — Charlie in the first,
            their guy in the second, Charlie again in the third, all adding to
            the right totals. Nothing here finishes anything. */}
        {todaysCounters.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
            {todaysCounters.map(s => {
              const isActive = s.id === active.id
              const shown = isActive ? count : s.pitches
              return (
                <button
                  key={s.id}
                  onClick={() => switchTo(s)}
                  className={`shrink-0 px-3 py-2 rounded-lg border text-left transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-xs font-medium truncate max-w-[8rem]">{s.label}</div>
                  <div className="text-lg font-bold tabular-nums leading-tight">{shown}</div>
                </button>
              )
            })}
            <button
              onClick={() => { setActive(null); setShowStart(true) }}
              className="shrink-0 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 flex items-center gap-1 text-sm"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        )}

        {resumedNote && (
          <div className="rounded-lg p-3 mb-3 bg-blue-50 border border-blue-200 text-sm text-blue-900">
            {resumedNote}
          </div>
        )}

        {(overDaily || nearDaily) && (
          <div className={`rounded-lg p-3 mb-4 flex items-start gap-2 text-sm ${
            overDaily ? 'bg-red-50 border border-red-200 text-red-800'
                      : 'bg-amber-50 border border-amber-200 text-amber-900'
          }`}>
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              {overDaily
                ? `Daily max for ${rule!.sanctioning_body} ${rule!.age_group} is ${rule!.daily_max}. He's at ${count}.`
                : `${rule!.daily_max! - count} pitches to the daily max.`}
            </span>
          </div>
        )}

        {/* The count. Nothing else on screen competes with it. */}
        <button
          onClick={() => bump(1)}
          className={`w-full rounded-2xl py-16 mb-3 select-none active:scale-[0.99] transition-transform ${
            overDaily ? 'bg-red-600' : 'bg-gray-900'
          } text-white`}
        >
          <div className="text-8xl font-bold tabular-nums leading-none">{count}</div>
          <div className="mt-3 text-sm uppercase tracking-widest opacity-70 flex items-center justify-center gap-1.5">
            <Plus size={14} /> tap anywhere to count
          </div>
        </button>

        {/* Switching is what happens on a pitching change — several times a
            game. Finishing happens once per pitcher, at the end. The green
            "Done" button used to own this spot, so the common action was
            missing and the rare one was the easiest thing to hit. */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => bump(-1)}
            disabled={count === 0}
            className="flex items-center justify-center gap-2 py-4 rounded-xl border border-gray-300 text-gray-700 disabled:opacity-40 active:bg-gray-50"
          >
            <Minus size={18} /> Undo
          </button>
          <button
            onClick={() => setActive(null)}
            className="flex items-center justify-center gap-2 py-4 rounded-xl bg-gray-900 text-white active:bg-gray-800"
          >
            <Users size={18} /> Switch pitcher
          </button>
        </div>

        <button
          onClick={finish}
          className="w-full mt-3 py-3 rounded-xl border border-green-300 text-green-800 bg-green-50 active:bg-green-100 flex items-center justify-center gap-2 text-sm font-medium"
        >
          <Check size={16} /> Finish {active.label}&apos;s day
        </button>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Switching keeps this count open — come back to it any time today.
          Finishing closes the day out{active.subject_type === 'opponent' ? ' and files it to scouting' : ''}, and
          you can still reopen it if they go back out.
        </p>
      </div>
    )
  }

  // ── Just finished ────────────────────────────────────
  if (active?.finished_at) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-6 text-center">
          <div className="text-sm text-gray-500">{active.label}</div>
          <div className="text-6xl font-bold text-gray-900 tabular-nums my-2">{active.pitches}</div>
          <div className="text-sm text-gray-500">pitches on {active.counted_on}</div>

          {availability ? (
            <div className={`mt-5 rounded-lg p-4 text-left text-sm ${
              availability.status === 'ineligible' ? 'bg-red-50 border border-red-200 text-red-800'
              : availability.status === 'limited' ? 'bg-amber-50 border border-amber-200 text-amber-900'
              : 'bg-green-50 border border-green-200 text-green-800'
            }`}>
              <div className="flex items-start gap-2">
                <Clock size={16} className="flex-shrink-0 mt-0.5" />
                <span>{availability.explanation}</span>
              </div>
            </div>
          ) : (
            <p className="mt-5 text-xs text-gray-500">
              Pick a rule set when you start a count and we&apos;ll tell you the rest days it costs.
            </p>
          )}

          {active.subject_type === 'opponent' && (
            <p className="mt-3 text-xs text-gray-500">
              Added to scouting — this shows up on their availability board next time you play them.
            </p>
          )}
        </div>
        <div className="space-y-2">
          {/* The most likely next thing after a pitching change is that same
              kid coming back out, and this used to be a dead end. */}
          <button
            onClick={() => reopen(active)}
            className="w-full py-3 rounded-lg bg-gray-900 text-white font-medium"
          >
            Back out there — keep counting
          </button>
          <button
            onClick={() => { setActive(null); setAvailability(null) }}
            className="w-full py-3 rounded-lg border border-gray-300 text-gray-700"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // ── Home ─────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pitch Counter</h1>
        <p className="text-gray-600 mt-1">
          Tap a name and start counting. No game setup, and it works for the other team&apos;s
          pitcher too.
        </p>
      </div>

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          Run <code className="bg-amber-100 px-1 rounded">migrations/016_game_notes_and_quick_counts.sql</code> in
          your Supabase SQL editor, then refresh.
        </div>
      )}

      {open.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Still counting</h2>
          <div className="space-y-2">
            {open.map(s => (
              <div key={s.id} className="flex items-center gap-3 bg-white rounded-lg shadow-sm border border-gray-200 p-3">
                <button onClick={() => resume(s)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                  <span className="text-2xl font-bold tabular-nums text-gray-900 w-12">{s.pitches}</span>
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900 truncate">{s.label}</span>
                    <span className="block text-xs text-gray-500">{s.counted_on}</span>
                  </span>
                </button>
                <button onClick={() => remove(s.id)} className="text-gray-300 hover:text-red-500 p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!showStart ? (
        <button
          onClick={() => setShowStart(true)}
          className="w-full py-4 rounded-xl bg-red-600 text-white font-medium flex items-center justify-center gap-2"
        >
          <Plus size={20} /> Start counting
        </button>
      ) : (
        <div className="bg-white rounded-lg shadow p-5 space-y-5">
          {rules.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Rules <span className="font-normal text-gray-500">(optional — gives you rest days)</span>
              </label>
              <select
                value={ruleSetId}
                onChange={e => setRuleSetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Just count, no rules</option>
                {rules.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.sanctioning_body} · {r.age_group}{r.daily_max ? ` (max ${r.daily_max})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {roster.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                <Users size={15} /> Your roster
              </div>
              <div className="flex flex-wrap gap-2">
                {roster.map(r => (
                  <button
                    key={r.team_player_id}
                    onClick={() => start({
                      subjectType: 'roster', teamPlayerId: r.team_player_id, label: r.name,
                    })}
                    disabled={starting}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm disabled:opacity-50"
                  >
                    {r.jersey_number ? `#${r.jersey_number} ` : ''}{r.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
              <Shield size={15} /> Someone else
            </div>
            <input
              value={adhocName}
              onChange={e => setAdhocName(e.target.value)}
              placeholder="Pitcher's name or number — e.g. #14 lefty"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-2"
            />
            <input
              value={opponentTeamName}
              onChange={e => setOpponentTeamName(e.target.value)}
              placeholder="Their team (optional)"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-2">
              Add their team and this outing goes into scouting, so their availability is already
              worked out next time you draw them.
            </p>
            <button
              onClick={() => start(
                opponentTeamName.trim()
                  ? { subjectType: 'opponent', label: adhocName, opponentName: opponentTeamName }
                  : { subjectType: 'adhoc', label: adhocName }
              )}
              disabled={starting || !adhocName.trim()}
              className="mt-3 w-full py-3 rounded-lg bg-gray-900 text-white disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {starting ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              Start counting
            </button>
          </div>

          <button onClick={() => setShowStart(false)} className="w-full text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Recent</h2>
          <div className="space-y-2">
            {recent.map(s => (
              <div key={s.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                <span className="text-lg font-bold tabular-nums text-gray-700 w-10">{s.pitches}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900 truncate">{s.label}</span>
                  <span className="block text-xs text-gray-500">
                    {s.counted_on}
                    {s.subject_type === 'opponent' ? ' · in scouting' : ''}
                  </span>
                </span>
                {/* Any date, not just today: "I hit Done a batter early" is as
                    common as a pitcher coming back out, and the date is right
                    there so nobody reopens the wrong one by accident. */}
                <button
                  onClick={() => reopen(s)}
                  className="text-xs text-gray-500 hover:text-gray-900 shrink-0 px-2 py-1 rounded border border-gray-300 bg-white"
                >
                  Continue
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CountPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={32} /></div>}>
      <CountContent />
    </Suspense>
  )
}
