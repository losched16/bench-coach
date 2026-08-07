'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Minus, Plus, Loader2, X, ChevronDown, Trash2, Gauge,
} from 'lucide-react'
import {
  MetricType, MetricReading, groupIntoSessions, computeTrend, formatValue,
  MIN_SESSIONS_FOR_TREND,
} from '@/lib/metrics'

// Tracking a number over time.
//
// The chart is hand-drawn SVG rather than a charting library. It plots one
// series of at most a few dozen points, and a dependency for that would be
// more weight than the whole feature — the same call as AnalysisProse.
//
// One rule the UI enforces alongside the AI: no trend line under three
// sessions. Two points always look like a trend and never are.

interface Props {
  coachId: string | null
  playerId: string
  playerName: string
  teamId: string | null
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export function PlayerMetrics({ coachId, playerId, playerName, teamId }: Props) {
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [types, setTypes] = useState<MetricType[]>([])
  const [readings, setReadings] = useState<MetricReading[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const [showLog, setShowLog] = useState(false)
  const [showNewType, setShowNewType] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [useBest, setUseBest] = useState(false)

  // log form
  const [measuredOn, setMeasuredOn] = useState(todayStr())
  const [rawValues, setRawValues] = useState('')
  const [successes, setSuccesses] = useState('')
  const [attempts, setAttempts] = useState('')
  const [note, setNote] = useState('')

  // new type form
  const [newLabel, setNewLabel] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [newShape, setNewShape] = useState<'measurement' | 'challenge'>('measurement')
  const [newDirection, setNewDirection] = useState<'higher' | 'lower'>('higher')

  const load = useCallback(async () => {
    if (!coachId) return
    try {
      const res = await fetch(`/api/metrics?coachId=${coachId}&playerId=${playerId}`)
      const data = await res.json()
      if (data.needsMigration) setNeedsMigration(true)
      setTypes(data.types || [])
      setReadings(data.readings || [])
    } catch {
      // panel stays empty
    } finally {
      setLoading(false)
    }
  }, [coachId, playerId])

  useEffect(() => { load() }, [load])

  // Types this player actually has data for, most-recently-used first, so the
  // things being tracked lead and the full catalogue stays out of the way.
  const tracked = useMemo(() => {
    const withData = new Set(readings.map(r => r.metric_type_id).filter(Boolean) as string[])
    return types.filter(t => withData.has(t.id))
  }, [types, readings])

  useEffect(() => {
    if (!selectedTypeId && tracked.length > 0) setSelectedTypeId(tracked[0].id)
  }, [tracked, selectedTypeId])

  const activeType = types.find(t => t.id === selectedTypeId) || null
  const activeReadings = useMemo(
    () => readings.filter(r => r.metric_type_id === selectedTypeId),
    [readings, selectedTypeId]
  )
  const sessions = useMemo(
    () => (activeType ? groupIntoSessions(activeReadings, activeType.direction) : []),
    [activeReadings, activeType]
  )
  const trend = useMemo(
    () => (activeType ? computeTrend(sessions, activeType, useBest ? 'best' : 'average') : null),
    [sessions, activeType, useBest]
  )

  const logType = types.find(t => t.id === selectedTypeId) || types[0] || null

  const submitReading = async () => {
    if (!coachId || !logType) return
    setSaving(true)
    setError(null)
    try {
      const payload: any = {
        coachId, playerId, teamId,
        metricTypeId: logType.id,
        measuredOn,
        note: note.trim() || undefined,
      }
      if (logType.shape === 'challenge') {
        payload.successes = Number(successes)
        payload.attempts = Number(attempts || logType.default_attempts || 10)
      } else {
        payload.values = rawValues
          .split(/[\s,]+/)
          .map(v => v.trim())
          .filter(Boolean)
          .map(Number)
      }

      const res = await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setRawValues(''); setSuccesses(''); setAttempts(''); setNote('')
      setShowLog(false)
      setSelectedTypeId(logType.id)
      await load()
    } catch (e: any) {
      setError(e.message || 'Could not save that')
    } finally {
      setSaving(false)
    }
  }

  const createType = async () => {
    if (!coachId || !newLabel.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId, kind: 'type',
          label: newLabel, unit: newUnit, shape: newShape, direction: newDirection,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setNewLabel(''); setNewUnit(''); setNewShape('measurement'); setNewDirection('higher')
      setShowNewType(false)
      await load()
      if (data.type) { setSelectedTypeId(data.type.id); setShowLog(true) }
    } catch (e: any) {
      setError(e.message || 'Could not create that')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="animate-spin" size={16} /> Loading measurements…
      </div>
    )
  }

  if (needsMigration) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        Run <code className="bg-amber-100 px-1 rounded">migrations/019_metrics.sql</code> in your Supabase
        SQL editor to start tracking measurements.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Gauge className="text-blue-600" size={18} />
          <h3 className="font-semibold text-gray-900">Measurements</h3>
        </div>
        <button
          onClick={() => { setShowLog(!showLog); setShowNewType(false) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Log
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-3">{error}</div>
      )}

      {/* ── Capture ── */}
      {showLog && logType && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">What</label>
              <select
                value={logType.id}
                onChange={e => setSelectedTypeId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {types.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label}{t.unit ? ` (${t.unit})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">When</label>
              <input
                type="date"
                value={measuredOn}
                onChange={e => setMeasuredOn(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {logType.shape === 'challenge' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">How many good</label>
                <input
                  type="number" inputMode="numeric" value={successes}
                  onChange={e => setSuccesses(e.target.value)}
                  placeholder="7"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Out of</label>
                <input
                  type="number" inputMode="numeric" value={attempts}
                  onChange={e => setAttempts(e.target.value)}
                  placeholder={String(logType.default_attempts || 10)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Reading{logType.unit ? ` (${logType.unit})` : ''}
              </label>
              <input
                value={rawValues}
                onChange={e => setRawValues(e.target.value)}
                placeholder="42  44  41  45"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {/* Ten swings is one session. Making the coach average them by
                  hand is how you lose both the best and the honest number. */}
              <p className="text-xs text-gray-500 mt-1">
                Type every reading from the session, separated by spaces — we&apos;ll keep the best and the
                average.
              </p>
            </div>
          )}

          {logType.hint && <p className="text-xs text-gray-500">{logType.hint}</p>}

          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. off the tee, new bat"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={submitReading}
              disabled={saving}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="animate-spin" size={14} />} Save
            </button>
            <button onClick={() => setShowLog(false)} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <button
              onClick={() => { setShowNewType(true); setShowLog(false) }}
              className="ml-auto text-sm text-blue-600 hover:text-blue-700"
            >
              Track something else
            </button>
          </div>
        </div>
      )}

      {/* ── Custom type ── */}
      {showNewType && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">What are you tracking?</label>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Bat speed, Broad jump"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Kind</label>
              <select
                value={newShape}
                onChange={e => setNewShape(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="measurement">A measurement (a number)</option>
                <option value="challenge">A challenge (x out of y)</option>
              </select>
            </div>
          </div>

          {newShape === 'measurement' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                <input
                  value={newUnit}
                  onChange={e => setNewUnit(e.target.value)}
                  placeholder="mph, sec, ft"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Which way is better?</label>
                {/* Gets asked because getting it wrong inverts every trend —
                    a faster home-to-first is a SMALLER number. */}
                <select
                  value={newDirection}
                  onChange={e => setNewDirection(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="higher">Higher is better</option>
                  <option value="lower">Lower is better (times, etc.)</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={createType}
              disabled={saving || !newLabel.trim()}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
            >
              Add it
            </button>
            <button onClick={() => setShowNewType(false)} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Empty ── */}
      {tracked.length === 0 && !showLog && !showNewType && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-700">Nothing measured for {playerName} yet.</p>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Exit velo off a tee, home to first, throws on target out of ten — anything you can measure the
            same way twice. Three sessions in, the check-in can tell you whether the work is moving it.
          </p>
        </div>
      )}

      {/* ── Series ── */}
      {tracked.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {tracked.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTypeId(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  t.id === selectedTypeId
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeType && trend && (
            <>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-gray-900 tabular-nums">
                      {sessions.length > 0
                        ? formatValue(useBest ? sessions[sessions.length - 1].best : sessions[sessions.length - 1].average, activeType)
                        : '—'}
                    </span>
                    {trend.verdict !== 'not_enough_data' && (
                      <span className={`flex items-center gap-1 text-sm ${
                        trend.verdict === 'improving' ? 'text-green-600'
                        : trend.verdict === 'declining' ? 'text-red-600'
                        : 'text-gray-500'
                      }`}>
                        {trend.verdict === 'improving' ? <TrendingUp size={15} />
                          : trend.verdict === 'declining' ? <TrendingDown size={15} />
                          : <Minus size={15} />}
                        {trend.verdict}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    latest of {sessions.length} session{sessions.length === 1 ? '' : 's'}
                    {activeType.direction === 'lower' ? ' · lower is better' : ''}
                  </p>
                </div>

                {sessions.some(s => s.count > 1) && (
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs flex-shrink-0">
                    {(['average', 'best'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setUseBest(mode === 'best')}
                        className={`px-2.5 py-1.5 capitalize ${
                          (mode === 'best') === useBest ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Sparkline
                sessions={sessions}
                useBest={useBest}
                direction={activeType.direction}
                showLine={sessions.length >= MIN_SESSIONS_FOR_TREND}
              />

              <p className={`text-sm mt-3 leading-relaxed ${
                trend.verdict === 'not_enough_data' ? 'text-amber-800' : 'text-gray-700'
              }`}>
                {trend.summary}
              </p>

              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 flex items-center gap-1">
                  <ChevronDown size={12} /> Every reading
                </summary>
                <div className="mt-2 space-y-1">
                  {[...activeReadings].reverse().map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="w-20 flex-shrink-0">{r.measured_on}</span>
                      <span className="font-medium text-gray-900">
                        {formatValue(Number(r.value), activeType)}
                      </span>
                      {r.attempts ? <span>({r.successes}/{r.attempts})</span> : null}
                      {r.note ? <span className="text-gray-500 truncate">— {r.note}</span> : null}
                      <button
                        onClick={async () => {
                          if (!coachId) return
                          await fetch(`/api/metrics?coachId=${coachId}&readingId=${r.id}`, { method: 'DELETE' })
                          await load()
                        }}
                        className="ml-auto text-gray-300 hover:text-red-500 flex-shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </>
      )}
    </div>
  )
}

// A single series, hand-drawn. A charting library would outweigh the feature.
function Sparkline({
  sessions, useBest, direction, showLine,
}: {
  sessions: Array<{ date: string; best: number; average: number }>
  useBest: boolean
  direction: 'higher' | 'lower'
  showLine: boolean
}) {
  const W = 600, H = 120, PAD = 8
  const values = sessions.map(s => (useBest ? s.best : s.average))
  if (values.length === 0) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, values.length - 1)
  // Screen y grows downward, so a "good" direction of lower still draws upward
  // to the right when it improves — the chart matches the verdict.
  const y = (v: number) => {
    const t = (v - min) / span
    const good = direction === 'lower' ? 1 - t : t
    return H - PAD - good * (H - PAD * 2)
  }

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        {showLine && (
          <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="4" fill={showLine ? '#2563eb' : '#9ca3af'} />
        ))}
      </svg>
      {!showLine && (
        <p className="text-xs text-amber-800 -mt-1">
          Points only — a line through {values.length} session{values.length === 1 ? '' : 's'} would suggest a
          trend that isn&apos;t there yet.
        </p>
      )}
    </div>
  )
}
