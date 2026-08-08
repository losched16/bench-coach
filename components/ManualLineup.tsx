'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, X, Check, AlertCircle, Undo2 } from 'lucide-react'
import { positionsFor } from '@/lib/lineup'

// Setting the lineup by hand.
//
// The solver is good and most coaches will use it. But a coach who has already
// decided — because of a conversation with a parent, a pitching plan, a kid who
// asked to try catcher — should not have to fight an optimiser to get the card
// they already have in their head. That coach types it in and moves on.
//
// This deliberately produces the SAME shape the generator produces. Everything
// downstream — the inning grid, drag-to-swap, saving, and the handoff into Game
// Day — then works without knowing where the lineup came from. A manual lineup
// is a first-class lineup, not a lesser one.
//
// What it does NOT do is enforce fairness or eligibility. It warns, in plain
// words, and then does what it is told. The coach is standing at the field and
// knows something we don't.

export interface ManualPlayer {
  id: string
  player: { id: string; name: string; jersey_number: string | null }
  positions?: string[] | null
}

export interface BuiltLineup {
  batting_order: Array<{ team_player_id: string; name: string; order: number }>
  field_assignments: Record<string, Array<{ team_player_id: string; name: string; position: string }>>
  bench_by_inning: Record<string, Array<{ team_player_id: string; name: string }>>
  innings_by_player: Record<string, number>
  notes: string
  warnings: string[]
  source: 'manual'
}

interface Row {
  teamPlayerId: string
  name: string
  jersey: string | null
  // '' means batting but on the bench to start.
  position: string
}

interface Props {
  players: ManualPlayer[]
  innings: number
  fieldPositions: number
  needsPitcher: boolean
  // Continuous order means everyone on the roster should be batting, so leaving
  // someone out is worth saying out loud.
  everyoneBats: boolean
  onCancel: () => void
  onDone: (lineup: BuiltLineup) => void
}

const BENCH = ''

export function ManualLineup({
  players, innings, fieldPositions, needsPitcher, everyoneBats, onCancel, onDone,
}: Props) {
  const positions = useMemo(
    () => positionsFor(fieldPositions, needsPitcher),
    [fieldPositions, needsPitcher]
  )

  const [order, setOrder] = useState<Row[]>([])

  const inOrder = new Set(order.map(r => r.teamPlayerId))
  const remaining = players.filter(p => !inOrder.has(p.id))
  const taken = new Set(order.map(r => r.position).filter(Boolean))

  // Tapping a name in should usually be the last click for that player. So we
  // guess their spot: the first open position they actually play, then the
  // first open position at all, then the bench. Wrong guesses cost one tap on
  // the dropdown; making the coach set nine positions by hand costs the
  // feature.
  const suggestPosition = (p: ManualPlayer): string => {
    const plays = (p.positions || []).filter(Boolean)
    const open = positions.filter(pos => !taken.has(pos))
    if (open.length === 0) return BENCH
    return open.find(pos => plays.includes(pos)) || open[0]
  }

  const add = (p: ManualPlayer) => {
    setOrder(prev => [...prev, {
      teamPlayerId: p.id,
      name: p.player.name,
      jersey: p.player.jersey_number,
      position: suggestPosition(p),
    }])
  }

  const addEveryone = () => {
    // Batting order first, positions filled in the order players are added —
    // the same guess, applied down the roster.
    setOrder(prev => {
      const next = [...prev]
      const used = new Set(next.map(r => r.position).filter(Boolean))
      for (const p of players) {
        if (next.some(r => r.teamPlayerId === p.id)) continue
        const plays = (p.positions || []).filter(Boolean)
        const open = positions.filter(pos => !used.has(pos))
        const pos = open.length === 0
          ? BENCH
          : (open.find(o => plays.includes(o)) || open[0])
        if (pos) used.add(pos)
        next.push({
          teamPlayerId: p.id,
          name: p.player.name,
          jersey: p.player.jersey_number,
          position: pos,
        })
      }
      return next
    })
  }

  const remove = (id: string) => setOrder(prev => prev.filter(r => r.teamPlayerId !== id))

  const move = (index: number, delta: number) => {
    setOrder(prev => {
      const to = index + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }

  // Picking a position someone else already has swaps them, rather than
  // silently creating two shortstops. A coach moving a kid to short means the
  // other kid goes where this one was.
  const setPosition = (index: number, position: string) => {
    setOrder(prev => {
      const next = [...prev]
      const was = next[index].position
      if (position) {
        const clash = next.findIndex((r, i) => i !== index && r.position === position)
        if (clash >= 0) next[clash] = { ...next[clash], position: was }
      }
      next[index] = { ...next[index], position }
      return next
    })
  }

  // ── What's wrong with it, said before they commit ──────
  const warnings: string[] = []
  const fielders = order.filter(r => r.position)
  if (order.length > 0) {
    if (fielders.length < positions.length) {
      const missing = positions.filter(p => !taken.has(p))
      warnings.push(
        `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} nobody in ${
          missing.length === 1 ? 'it' : 'them'
        } for the first inning.`
      )
    }
    if (order.length < 9) {
      warnings.push(`Only ${order.length} in the batting order.`)
    }
    if (everyoneBats && remaining.length > 0) {
      warnings.push(
        `${remaining.map(p => p.player.name).join(', ')} ${
          remaining.length === 1 ? 'is' : 'are'
        } not in the batting order. In a continuous order everyone bats.`
      )
    }
  }

  const build = () => {
    const batting_order = order.map((r, i) => ({
      team_player_id: r.teamPlayerId,
      name: r.name,
      order: i + 1,
    }))

    const field = order
      .filter(r => r.position)
      .map(r => ({ team_player_id: r.teamPlayerId, name: r.name, position: r.position }))
    const bench = order
      .filter(r => !r.position)
      .map(r => ({ team_player_id: r.teamPlayerId, name: r.name }))

    // The starting card carries forward to every inning. That is what a coach
    // setting a lineup by hand means: this is how we start, and I'll move
    // people as the game goes. The grid below and the in-game swap screen are
    // both there to change any inning they want to change.
    const field_assignments: BuiltLineup['field_assignments'] = {}
    const bench_by_inning: BuiltLineup['bench_by_inning'] = {}
    for (let i = 1; i <= innings; i++) {
      field_assignments[String(i)] = field.map(f => ({ ...f }))
      bench_by_inning[String(i)] = bench.map(b => ({ ...b }))
    }

    const innings_by_player: Record<string, number> = {}
    for (const f of field) innings_by_player[f.team_player_id] = innings
    for (const b of bench) innings_by_player[b.team_player_id] = 0

    onDone({
      batting_order,
      field_assignments,
      bench_by_inning,
      innings_by_player,
      notes: 'Set by hand.',
      warnings,
      source: 'manual',
    })
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Set the lineup yourself</h3>
          <p className="text-sm text-gray-600 mt-1">
            Tap players in the order they bat. We&apos;ll guess a position for each one — change
            any of them. This becomes the starting card, and you can move people around by
            inning on the grid or during the game.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap"
        >
          Cancel
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* ── The roster, waiting ───────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Roster {remaining.length > 0 && <span className="text-gray-400">({remaining.length} left)</span>}
            </label>
            {remaining.length > 0 && (
              <button
                onClick={addEveryone}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Add everyone
              </button>
            )}
          </div>
          {remaining.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">Everyone is in the order.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {remaining.map(p => (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  {p.player.name}
                  {p.player.jersey_number && (
                    <span className="text-xs text-gray-400 ml-1">#{p.player.jersey_number}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── The order ─────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Batting order {order.length > 0 && <span className="text-gray-400">({order.length})</span>}
            </label>
            {order.length > 0 && (
              <button
                onClick={() => setOrder([])}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <Undo2 size={12} /> Start over
              </button>
            )}
          </div>

          {order.length === 0 ? (
            <p className="text-sm text-gray-400 py-3 border border-dashed border-gray-200 rounded-lg px-3">
              Nobody yet — tap a name to start the order.
            </p>
          ) : (
            <div className="space-y-1.5">
              {order.map((r, i) => (
                <div
                  key={r.teamPlayerId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-gray-200"
                >
                  <span className="w-5 text-xs font-bold text-gray-400 text-right">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                    {r.name}
                  </span>
                  <select
                    value={r.position}
                    onChange={e => setPosition(i, e.target.value)}
                    className={`text-xs border rounded px-1.5 py-1 ${
                      r.position
                        ? 'border-gray-300 bg-white text-gray-900'
                        : 'border-gray-200 bg-gray-50 text-gray-500'
                    }`}
                    aria-label={`Position for ${r.name}`}
                  >
                    <option value={BENCH}>Bench</option>
                    {positions.map(pos => (
                      <option key={pos} value={pos}>{pos}</option>
                    ))}
                  </select>
                  <div className="flex">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      aria-label={`Move ${r.name} up`}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      aria-label={`Move ${r.name} down`}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      onClick={() => remove(r.teamPlayerId)}
                      className="p-1 text-gray-400 hover:text-red-600"
                      aria-label={`Take ${r.name} out of the order`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Said, not enforced. The coach is at the field and we are not. */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-900 flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{w}</span>
            </p>
          ))}
          <p className="text-xs text-amber-700 pl-6">
            You can use it anyway — this is just what we noticed.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={build}
          disabled={order.length === 0}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={18} />
          <span>Use this lineup</span>
        </button>
      </div>
    </div>
  )
}
