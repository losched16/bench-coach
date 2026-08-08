'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, AlertCircle, Undo2, BookOpen, ChevronDown, ChevronUp, Check, X,
} from 'lucide-react'
import {
  PA_RESULTS, BASE_RESULTS, PAResult, BaseResult, Count, NEW_COUNT, addPitch,
  impliedResult, PitchKind, Bases, EMPTY_BASES, Runner, GameState, applyPA,
  applyBaseEvent, StoredEvent, boxScore, ip, avg, POSITION_NUMBERS, scoringNotation,
} from '@/lib/scorebook'

// Keeping the book, on a phone, with one hand, while watching the field.
//
// Everything here is built around that sentence. The pitch pad is four big
// targets. A plate appearance ends in one tap, and the sheet that follows shows
// what the app THINKS happened with every runner adjustable — because the
// defaults are right most of the time and wrong often enough that a book which
// can't be corrected is a book nobody trusts.
//
// The count is held locally and persisted, so a phone that locks mid-at-bat
// doesn't lose five pitches off a kid's arm.

interface OrderEntry {
  teamPlayerId: string
  playerId: string | null
  name: string
  jersey: string | null
  slot: number
  isIn: boolean
}

interface Props {
  gameId: string
  // The pitcher the game screen is counting for. The book credits their line
  // rather than asking again.
  currentPitcher: string | null
  pitcherName?: string | null
}

type Slot = 'out' | '1' | '2' | '3' | 'home'

interface SheetRunner {
  id: string
  name: string
  earned: boolean
  slot: Slot
  // The batter's row is labelled differently and sorts first.
  isBatter: boolean
}

const SLOTS: Array<{ v: Slot; label: string }> = [
  { v: 'out', label: 'Out' },
  { v: '1', label: '1st' },
  { v: '2', label: '2nd' },
  { v: '3', label: '3rd' },
  { v: 'home', label: 'Scored' },
]

// Results that put a runner on without the defence retiring him cleanly — runs
// off these are unearned against our pitcher.
const UNEARNED_RESULTS = new Set<string>(['E'])

export function Scorebook({ gameId, currentPitcher, pitcherName }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null)

  const [state, setState] = useState<GameState>({
    inning: 1, half: 'top', outs: 0, bases: { ...EMPTY_BASES }, awayRuns: 0, homeRuns: 0,
  })
  const [weBatting, setWeBatting] = useState(false)
  const [order, setOrder] = useState<OrderEntry[]>([])
  const [dueUpIndex, setDueUpIndex] = useState(0)
  const [opponentSlot, setOpponentSlot] = useState(1)
  const [opponentNames, setOpponentNames] = useState<Record<number, string>>({})
  const [events, setEvents] = useState<StoredEvent[]>([])
  const [lastSeq, setLastSeq] = useState(0)
  const [isHome, setIsHome] = useState(true)

  // The at-bat in progress.
  const [count, setCount] = useState<Count>(NEW_COUNT)
  const [batterOverride, setBatterOverride] = useState<string | null>(null)
  const [opponentName, setOpponentName] = useState('')

  // The confirm sheet.
  const [sheet, setSheet] = useState<{
    kind: 'pa' | 'base'
    result: string
    label: string
    runners: SheetRunner[]
    rbi: number
    fielders: string[]
    outsBefore: number
  } | null>(null)

  const [bookOpen, setBookOpen] = useState(false)
  const [boxOpen, setBoxOpen] = useState(false)

  const countKey = `bc-count-${gameId}`

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/scorebook?gameId=${gameId}`)
      const d = await res.json()
      if (d.needsMigration) { setMigrationMessage(d.migrationMessage); return }
      setState(d.state)
      setWeBatting(!!d.weBatting)
      setOrder(d.order || [])
      setDueUpIndex(d.dueUpIndex || 0)
      setOpponentSlot(d.opponentSlot || 1)
      setOpponentNames(d.opponentNames || {})
      setEvents(d.events || [])
      setIsHome(d.isHome !== false)
      setLastSeq((d.events || []).length ? d.events[d.events.length - 1].seq : 0)
    } catch {
      setError('Could not load the book.')
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => { load() }, [load])

  // A locked phone mid-at-bat must not cost the count.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(countKey)
      if (raw) setCount(JSON.parse(raw))
    } catch { /* a lost count is not worth an error */ }
  }, [countKey])

  useEffect(() => {
    try { localStorage.setItem(countKey, JSON.stringify(count)) } catch { /* ignore */ }
  }, [count, countKey])

  // ── Who is up ──────────────────────────────────────────
  const batter: OrderEntry | null = useMemo(() => {
    if (!weBatting || order.length === 0) return null
    if (batterOverride) return order.find(o => o.teamPlayerId === batterOverride) || null
    return order[dueUpIndex % order.length] || null
  }, [weBatting, order, dueUpIndex, batterOverride])

  const batterRunner: Runner = weBatting
    ? { id: batter?.teamPlayerId || 'unknown', name: batter?.name || 'Batter', earned: true }
    : {
        id: `opp-${opponentSlot}`,
        name: opponentName.trim() || opponentNames[opponentSlot] || `#${opponentSlot}`,
        earned: true,
      }

  // ── The pitch pad ──────────────────────────────────────
  const pitch = (kind: PitchKind) => {
    const next = addPitch(count, kind)
    setCount(next)
    if (navigator.vibrate) navigator.vibrate(20)
    // Offered, not applied — a coach who taps ball four and finds the runner
    // already on first has to undo something they never chose.
    const implied = impliedResult(next)
    if (implied) openSheet('pa', implied)
  }

  // ── Opening the confirm sheet ──────────────────────────
  const openSheet = (kind: 'pa' | 'base', result: string, from?: 1 | 2 | 3) => {
    const b = state.bases
    const outcome = kind === 'pa'
      ? applyPA(state, result as PAResult, {
          ...batterRunner,
          earned: !UNEARNED_RESULTS.has(result),
        })
      : applyBaseEvent(state, result as BaseResult, from || 1)

    // Everyone the play could have touched, with where the defaults put them.
    const involved: SheetRunner[] = []
    const place = (r: Runner, isBatter: boolean) => {
      let slot: Slot = 'out'
      if (outcome.bases.first?.id === r.id) slot = '1'
      else if (outcome.bases.second?.id === r.id) slot = '2'
      else if (outcome.bases.third?.id === r.id) slot = '3'
      else if (outcome.scored.some(s => s.id === r.id)) slot = 'home'
      involved.push({ id: r.id, name: r.name, earned: r.earned, slot, isBatter })
    }

    if (kind === 'pa') place({ ...batterRunner, earned: !UNEARNED_RESULTS.has(result) }, true)
    if (b.third) place(b.third, false)
    if (b.second) place(b.second, false)
    if (b.first) place(b.first, false)

    const runs = involved.filter(r => r.slot === 'home').length
    const cfg = kind === 'pa' ? PA_RESULTS[result as PAResult] : BASE_RESULTS[result as BaseResult]

    setSheet({
      kind,
      result,
      label: cfg?.label || result,
      runners: involved,
      // An error or a double play doesn't get an RBI; everything else that
      // scores someone does, until the coach says otherwise.
      rbi: kind === 'pa' && !['E', 'DP', 'TP'].includes(result) ? runs : 0,
      fielders: [],
      outsBefore: state.outs,
    })
  }

  const setSlot = (id: string, slot: Slot) => {
    setSheet(s => s ? {
      ...s,
      runners: s.runners.map(r => r.id === id ? { ...r, slot } : r),
    } : s)
  }

  // ── Committing it ──────────────────────────────────────
  const sheetOuts = sheet
    ? Math.min(3, sheet.outsBefore + sheet.runners.filter(r => r.slot === 'out').length)
    : 0
  const sheetScored = sheet ? sheet.runners.filter(r => r.slot === 'home') : []
  const doubledUp = sheet
    ? (['1', '2', '3'] as Slot[]).filter(s => sheet.runners.filter(r => r.slot === s).length > 1)
    : []

  const commit = async () => {
    if (!sheet || doubledUp.length > 0) return
    setSaving(true)
    setError(null)

    const at = (s: Slot): Runner | null => {
      const r = sheet.runners.find(x => x.slot === s)
      return r ? { id: r.id, name: r.name, earned: r.earned } : null
    }
    // Three outs empties the bases whatever the sheet says — runners left on
    // do not carry over, and a book that carries them is off by a runner for
    // the rest of the game.
    const basesAfter: Bases = sheetOuts >= 3
      ? { ...EMPTY_BASES }
      : { first: at('1'), second: at('2'), third: at('3') }

    try {
      const res = await fetch('/api/game/scorebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          expectedSeq: lastSeq,
          kind: sheet.kind,
          result: sheet.result,
          scoring: sheet.kind === 'pa' && sheet.fielders.length
            ? scoringNotation(sheet.result as PAResult, sheet.fielders)
            : null,
          batterTeamPlayerId: weBatting ? batter?.teamPlayerId || null : null,
          opponentSlot: weBatting ? null : opponentSlot,
          opponentName: weBatting ? null : (opponentName.trim() || opponentNames[opponentSlot] || null),
          pitcherPlayerId: weBatting ? null : currentPitcher,
          balls: sheet.kind === 'pa' ? count.balls : 0,
          strikes: sheet.kind === 'pa' ? count.strikes : 0,
          pitches: sheet.kind === 'pa' ? count.pitches : 0,
          rbi: sheet.rbi,
          outsAfter: sheetOuts,
          basesAfter,
          scored: sheetScored.map(r => ({ id: r.id, name: r.name, earned: r.earned })),
          adjusted: true,
        }),
      })
      const d = await res.json()
      if (res.status === 409) { setError(d.error); await load(); setSheet(null); return }
      if (!res.ok) throw new Error(d.error || 'Could not record that')

      // A plate appearance ends the count and the override; a stolen base
      // doesn't touch either.
      if (sheet.kind === 'pa') {
        setCount(NEW_COUNT)
        setBatterOverride(null)
        setOpponentName('')
      }
      setSheet(null)
      await load()
      if (navigator.vibrate) navigator.vibrate(40)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const setHome = async (v: boolean) => {
    if (v === isHome) return
    setIsHome(v)
    try {
      await fetch('/api/game/scorebook', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, isHome: v }),
      })
      await load()
    } catch {
      setError('Could not change that.')
    }
  }

  const undo = async () => {
    if (!confirm('Undo the last thing in the book?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/game/scorebook?gameId=${gameId}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not undo that')
      setCount(NEW_COUNT)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 p-4">
        <Loader2 className="animate-spin" size={15} /> Opening the book…
      </div>
    )
  }

  if (migrationMessage) {
    return (
      <div className="m-4 flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
        <p>{migrationMessage}</p>
      </div>
    )
  }

  const names: Record<string, string> = {}
  for (const o of order) {
    names[o.teamPlayerId] = o.name
    if (o.playerId) names[o.playerId] = o.name
  }
  const box = boxScore(events, names)
  const onBase = [
    state.bases.third ? { base: 3 as const, r: state.bases.third } : null,
    state.bases.second ? { base: 2 as const, r: state.bases.second } : null,
    state.bases.first ? { base: 1 as const, r: state.bases.first } : null,
  ].filter(Boolean) as Array<{ base: 1 | 2 | 3; r: Runner }>

  return (
    <div className="p-4 space-y-4">
      {/* ── Where we are ─────────────────────────────── */}
      <div className="bg-gray-900 text-white rounded-xl p-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">
            {state.half === 'top' ? 'Top' : 'Bottom'} {state.inning}
          </div>
          <div className="text-lg font-bold">
            {weBatting ? 'We’re batting' : 'In the field'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400">Outs</div>
          <div className="flex gap-1 mt-0.5">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className={`w-3 h-3 rounded-full ${i < state.outs ? 'bg-red-500' : 'bg-gray-700'}`}
              />
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">Us – Them</div>
          <div className="text-lg font-bold tabular-nums">
            {isHome ? `${state.homeRuns} – ${state.awayRuns}` : `${state.awayRuns} – ${state.homeRuns}`}
          </div>
        </div>
      </div>

      {/* Which dugout. Getting this wrong flips which half we bat, so it is
          fixable here rather than only in a setup form from an hour ago. */}
      <div className="flex items-center justify-center gap-2 text-xs">
        <span className="text-gray-500">We are the</span>
        {[true, false].map(h => (
          <button
            key={String(h)}
            onClick={() => setHome(h)}
            className={`px-3 py-1 rounded-full border font-medium ${
              isHome === h
                ? 'border-gray-800 bg-gray-800 text-white'
                : 'border-gray-200 text-gray-600'
            }`}
          >
            {h ? 'home team' : 'away team'}
          </button>
        ))}
      </div>

      {/* ── The bases ────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 text-xs">
        {([3, 2, 1] as const).map(b => {
          const r = b === 1 ? state.bases.first : b === 2 ? state.bases.second : state.bases.third
          return (
            <div
              key={b}
              className={`flex-1 rounded-lg border px-2 py-2 text-center ${
                r ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-400'
              }`}
            >
              <div className="font-bold">{b === 1 ? '1st' : b === 2 ? '2nd' : '3rd'}</div>
              <div className="truncate">{r ? r.name : '—'}</div>
            </div>
          )
        })}
      </div>

      {/* Runners do things between pitches, and at this level that is most of
          the offence. */}
      {onBase.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {onBase.map(({ base, r }) => (
            <div key={r.id} className="flex items-center gap-1 text-xs">
              <span className="text-gray-500">{r.name}:</span>
              {(['SB', 'CS', 'PB', 'WP', 'PK'] as BaseResult[]).map(br => (
                <button
                  key={br}
                  onClick={() => openSheet('base', br, base)}
                  className="px-2 py-1 rounded border border-gray-200 text-gray-700 active:bg-gray-100"
                >
                  {BASE_RESULTS[br].short}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Who is up ────────────────────────────────── */}
      <div className="border border-gray-200 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-500">At the plate</span>
          {!weBatting && (
            <span className="text-xs text-gray-500">
              Pitching: {pitcherName || (currentPitcher ? 'set on the pitch panel' : 'nobody set')}
            </span>
          )}
        </div>

        {weBatting ? (
          order.length === 0 ? (
            <p className="text-sm text-gray-500">
              No batting order yet — set the lineup and the book will follow it.
            </p>
          ) : (
            <select
              value={batter?.teamPlayerId || ''}
              onChange={e => setBatterOverride(e.target.value)}
              className="w-full text-base font-semibold border border-gray-300 rounded-lg px-3 py-2"
              aria-label="Batter"
            >
              {order.map(o => (
                <option key={o.teamPlayerId} value={o.teamPlayerId}>
                  {o.slot}. {o.name}{o.jersey ? ` #${o.jersey}` : ''}
                </option>
              ))}
            </select>
          )
        ) : (
          <div className="flex gap-2">
            <select
              value={opponentSlot}
              onChange={e => setOpponentSlot(Number(e.target.value))}
              className="w-24 text-base font-semibold border border-gray-300 rounded-lg px-2 py-2"
              aria-label="Their batting slot"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>#{n}</option>
              ))}
            </select>
            <input
              value={opponentName}
              onChange={e => setOpponentName(e.target.value)}
              placeholder={opponentNames[opponentSlot] || 'Name (optional)'}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base"
            />
          </div>
        )}

        {/* The count. Four targets, thumb-sized. */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-2xl font-bold tabular-nums text-gray-900">
            {count.balls}–{count.strikes}
          </span>
          <span className="text-xs text-gray-500">{count.pitches} pitches</span>
          {count.pitches > 0 && (
            <button
              onClick={() => setCount(NEW_COUNT)}
              className="text-xs text-gray-500 underline"
            >
              Reset count
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {([
            { k: 'ball' as PitchKind, label: 'Ball', cls: 'bg-green-600' },
            { k: 'strike' as PitchKind, label: 'Strike', cls: 'bg-red-600' },
            { k: 'foul' as PitchKind, label: 'Foul', cls: 'bg-amber-500' },
            { k: 'in_play' as PitchKind, label: 'In play', cls: 'bg-blue-600' },
          ]).map(b => (
            <button
              key={b.k}
              onClick={() => pitch(b.k)}
              className={`${b.cls} text-white rounded-xl py-3 text-sm font-bold active:opacity-80`}
            >
              {b.label}
            </button>
          ))}
        </div>
        {!weBatting && !currentPitcher && (
          <p className="text-xs text-amber-700">
            No pitcher selected on the pitch panel, so these pitches won&apos;t land on anyone&apos;s count.
          </p>
        )}
      </div>

      {/* ── How it ended ─────────────────────────────── */}
      <div className="space-y-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">How it ended</span>
        {(['hit', 'onbase', 'out', 'other'] as const).map(group => (
          <div key={group} className="grid grid-cols-4 gap-1.5">
            {(Object.keys(PA_RESULTS) as PAResult[])
              .filter(r => PA_RESULTS[r].group === group)
              .map(r => (
                <button
                  key={r}
                  onClick={() => openSheet('pa', r)}
                  className={`rounded-lg py-2.5 text-sm font-bold border active:opacity-70 ${
                    group === 'hit'
                      ? 'border-green-300 bg-green-50 text-green-800'
                      : group === 'out'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-gray-200 bg-white text-gray-800'
                  }`}
                  title={PA_RESULTS[r].label}
                >
                  {PA_RESULTS[r].short}
                </button>
              ))}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={undo}
          disabled={saving || events.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 disabled:opacity-40"
        >
          <Undo2 size={15} /> Undo last
        </button>
        <button
          onClick={() => setBookOpen(!bookOpen)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700"
        >
          <BookOpen size={15} /> The book ({events.length})
          {bookOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          onClick={() => setBoxOpen(!boxOpen)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700"
        >
          Box score
          {boxOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ── The book ─────────────────────────────────── */}
      {bookOpen && (
        <div className="border border-gray-200 rounded-lg divide-y max-h-72 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-sm text-gray-500 p-3">Nothing scored yet.</p>
          ) : (
            [...events].reverse().map(e => (
              <div key={e.seq} className="px-3 py-2 text-sm flex items-center gap-2">
                <span className="text-xs text-gray-400 w-12 shrink-0">
                  {e.half === 'top' ? 'T' : 'B'}{e.inning}
                </span>
                <span className="flex-1 truncate text-gray-900">
                  {names[e.batterId || ''] || e.batterName || (e.weBatting ? 'Batter' : 'Them')}
                </span>
                <span className="font-bold text-gray-700">{e.scoring || e.result}</span>
                {e.rbi > 0 && <span className="text-xs text-green-700">{e.rbi} RBI</span>}
                {(e.scored?.length || 0) > 0 && (
                  <span className="text-xs text-blue-700">{e.scored.length}R</span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── The box score, derived ───────────────────── */}
      {boxOpen && (
        <div className="space-y-3">
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-2 py-1.5">Batting</th>
                  <th className="px-1.5">AB</th><th className="px-1.5">R</th>
                  <th className="px-1.5">H</th><th className="px-1.5">RBI</th>
                  <th className="px-1.5">BB</th><th className="px-1.5">K</th>
                  <th className="px-1.5">AVG</th>
                </tr>
              </thead>
              <tbody>
                {box.batting.length === 0 ? (
                  <tr><td colSpan={8} className="px-2 py-2 text-gray-400">Nobody has batted yet.</td></tr>
                ) : box.batting.map(b => (
                  <tr key={b.playerId} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 text-gray-900 whitespace-nowrap">{b.name}</td>
                    <td className="text-center tabular-nums">{b.ab}</td>
                    <td className="text-center tabular-nums">{b.runs}</td>
                    <td className="text-center tabular-nums">{b.h}</td>
                    <td className="text-center tabular-nums">{b.rbi}</td>
                    <td className="text-center tabular-nums">{b.bb}</td>
                    <td className="text-center tabular-nums">{b.k}</td>
                    <td className="text-center tabular-nums">{avg(b.h, b.ab)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-2 py-1.5">Pitching</th>
                  <th className="px-1.5">IP</th><th className="px-1.5">P</th>
                  <th className="px-1.5">H</th><th className="px-1.5">BB</th>
                  <th className="px-1.5">K</th><th className="px-1.5">R</th>
                  <th className="px-1.5">ER</th>
                </tr>
              </thead>
              <tbody>
                {box.pitching.length === 0 ? (
                  <tr><td colSpan={8} className="px-2 py-2 text-gray-400">Nobody has pitched yet.</td></tr>
                ) : box.pitching.map(p => (
                  <tr key={p.playerId} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 text-gray-900 whitespace-nowrap">{p.name}</td>
                    <td className="text-center tabular-nums">{ip(p.outs)}</td>
                    <td className="text-center tabular-nums">{p.pitches}</td>
                    <td className="text-center tabular-nums">{p.h}</td>
                    <td className="text-center tabular-nums">{p.bb}</td>
                    <td className="text-center tabular-nums">{p.k}</td>
                    <td className="text-center tabular-nums">{p.runs}</td>
                    <td className="text-center tabular-nums">{p.earned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── The confirm sheet ────────────────────────── */}
      {sheet && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-4 space-y-3 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">{sheet.label}</h3>
              <button onClick={() => setSheet(null)} className="p-1 text-gray-400" aria-label="Cancel">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-gray-500">
              This is where we think everyone ended up. Change anyone who went further,
              or didn&apos;t.
            </p>

            <div className="space-y-2">
              {sheet.runners.map(r => (
                <div key={r.id}>
                  <div className="text-sm font-medium text-gray-900 mb-1">
                    {r.name}
                    {r.isBatter && <span className="text-xs text-gray-400 ml-1">(batter)</span>}
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {SLOTS.map(s => (
                      <button
                        key={s.v}
                        onClick={() => setSlot(r.id, s.v)}
                        className={`py-2 rounded-lg text-xs font-medium border ${
                          r.slot === s.v
                            ? s.v === 'out'
                              ? 'border-red-500 bg-red-50 text-red-700'
                              : s.v === 'home'
                              ? 'border-green-500 bg-green-50 text-green-700'
                              : 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Who touched it. Two taps buys "6-3" in the book instead of "GO". */}
            {sheet.kind === 'pa' && (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  Who fielded it? <span className="normal-case text-gray-400">(optional)</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {POSITION_NUMBERS.map(({ n, pos }) => {
                    const at = sheet.fielders.indexOf(n)
                    return (
                      <button
                        key={n}
                        onClick={() => setSheet(s => s ? {
                          ...s,
                          fielders: at >= 0
                            ? s.fielders.filter(f => f !== n)
                            : [...s.fielders, n],
                        } : s)}
                        className={`px-2.5 py-1.5 rounded border text-xs ${
                          at >= 0
                            ? 'border-gray-800 bg-gray-800 text-white'
                            : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        {n} <span className="opacity-60">{pos}</span>
                        {at >= 0 && <span className="ml-0.5 opacity-70">{at + 1}</span>}
                      </button>
                    )
                  })}
                </div>
                {sheet.fielders.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Scores as <strong>{scoringNotation(sheet.result as PAResult, sheet.fielders)}</strong>
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <div className="text-sm text-gray-600">
                Outs <strong className="text-gray-900">{sheetOuts}</strong>
                {sheetScored.length > 0 && (
                  <span className="ml-3">
                    Runs <strong className="text-gray-900">{sheetScored.length}</strong>
                  </span>
                )}
              </div>
              {sheet.kind === 'pa' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">RBI</span>
                  <button
                    onClick={() => setSheet(s => s ? { ...s, rbi: Math.max(0, s.rbi - 1) } : s)}
                    className="w-8 h-8 rounded-lg border border-gray-300 text-gray-700"
                  >−</button>
                  <span className="w-5 text-center font-bold tabular-nums">{sheet.rbi}</span>
                  <button
                    onClick={() => setSheet(s => s ? { ...s, rbi: Math.min(4, s.rbi + 1) } : s)}
                    className="w-8 h-8 rounded-lg border border-gray-300 text-gray-700"
                  >+</button>
                </div>
              )}
            </div>

            {doubledUp.length > 0 && (
              <div className="flex gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>Two runners on the same base. Move one of them before saving.</span>
              </div>
            )}

            {sheetOuts >= 3 && (
              <p className="text-xs text-gray-500">
                That&apos;s three — the bases clear and the half is over.
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setSheet(null)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={saving || doubledUp.length > 0}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                Save it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
