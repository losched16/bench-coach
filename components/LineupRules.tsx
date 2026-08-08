'use client'

import { useEffect, useState } from 'react'
import { Lock, Loader2, AlertCircle, ChevronDown, Check } from 'lucide-react'

// The rules the solver is not allowed to optimise away.
//
// Set once and they hold all season, because "RJ only plays short" is true of
// RJ, not of Saturday. A coach who has to re-enter this every game enters it
// once and then stops using the builder.

const ALL_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']

interface PlayerRule {
  teamPlayerId: string
  name: string
  jerseyNumber: string | null
  lockedPosition: string | null
  excludedPositions: string[]
  minInnings: number | null
  maxInnings: number | null
}

interface Props {
  teamId: string
  onChanged?: () => void
}

export function LineupRules({ teamId, onChanged }: Props) {
  const [players, setPlayers] = useState<PlayerRule[]>([])
  const [minInningsAll, setMinInningsAll] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch(`/api/lineup/constraints?teamId=${teamId}`)
      const d = await res.json()
      setPlayers(d.players || [])
      setMinInningsAll(d.team?.minInningsAll == null ? '' : String(d.team.minInningsAll))
      if (d.needsMigration) setMigrationMessage(d.migrationMessage || 'Run migration 027.')
    } catch {
      /* no rules is a valid state */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [teamId])

  const savePlayer = async (teamPlayerId: string, patch: Partial<PlayerRule>) => {
    setSavingId(teamPlayerId)
    setError(null)
    // Optimistic: these are one-column writes and the coach is scanning a grid.
    setPlayers(prev => prev.map(p => (p.teamPlayerId === teamPlayerId ? { ...p, ...patch } : p)))
    try {
      const res = await fetch('/api/lineup/constraints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, player: { teamPlayerId, ...patch } }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save that rule')
      onChanged?.()
    } catch (e: any) {
      setError(e.message)
      load()
    } finally {
      setSavingId(null)
    }
  }

  const saveTeamMin = async (value: string) => {
    setMinInningsAll(value)
    setError(null)
    try {
      await fetch('/api/lineup/constraints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          team: { minInningsAll: value === '' ? null : Number(value) },
        }),
      })
      onChanged?.()
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (loading) return null

  if (migrationMessage) {
    return (
      <div className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
        <p>{migrationMessage}</p>
      </div>
    )
  }

  const withRules = players.filter(
    p => p.lockedPosition || p.excludedPositions.length > 0 || p.minInnings != null || p.maxInnings != null
  ).length

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center gap-2 text-sm text-gray-800 hover:bg-gray-50 rounded-lg"
      >
        <Lock size={15} className="text-gray-400" />
        <span className="font-medium">Rules</span>
        <span className="text-gray-500">
          {minInningsAll ? `everyone plays ${minInningsAll}+` : 'no minimum set'}
          {withRules > 0 && ` · ${withRules} player${withRules === 1 ? '' : 's'} with limits`}
        </span>
        <ChevronDown size={15} className={`ml-auto text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-4">
          {/* The league rule, said once. 8U travel usually requires every
              rostered kid to field an inning. */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
              Minimum innings for everyone
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={9}
                value={minInningsAll}
                onChange={e => saveTeamMin(e.target.value)}
                placeholder="none"
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <span className="text-xs text-gray-500">
                Applies to every player unless they have their own below.
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="space-y-2">
            {players.map(p => (
              <div key={p.teamPlayerId} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-gray-900 text-sm">
                    {p.jerseyNumber ? `#${p.jerseyNumber} ` : ''}{p.name}
                  </span>
                  {savingId === p.teamPlayerId && (
                    <Loader2 className="animate-spin text-gray-400" size={13} />
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Only plays</label>
                    <select
                      value={p.lockedPosition || ''}
                      onChange={e => savePlayer(p.teamPlayerId, { lockedPosition: e.target.value || null })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">Anywhere</option>
                      {ALL_POSITIONS.map(pos => (
                        <option key={pos} value={pos}>{pos}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 mb-1">Min innings</label>
                      <input
                        type="number" min={0} max={9}
                        value={p.minInnings ?? ''}
                        onChange={e => savePlayer(p.teamPlayerId, {
                          minInnings: e.target.value === '' ? null : Number(e.target.value),
                        })}
                        placeholder="—"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 mb-1">Max innings</label>
                      <input
                        type="number" min={0} max={9}
                        value={p.maxInnings ?? ''}
                        onChange={e => savePlayer(p.teamPlayerId, {
                          maxInnings: e.target.value === '' ? null : Number(e.target.value),
                        })}
                        placeholder="—"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Exclusions, only when they aren't locked — a lock already
                    says everything an exclusion could. */}
                {!p.lockedPosition && (
                  <div className="mt-2">
                    <label className="block text-xs text-gray-600 mb-1">Never plays</label>
                    <div className="flex flex-wrap gap-1">
                      {ALL_POSITIONS.map(pos => {
                        const excluded = p.excludedPositions.includes(pos)
                        return (
                          <button
                            key={pos}
                            onClick={() => savePlayer(p.teamPlayerId, {
                              excludedPositions: excluded
                                ? p.excludedPositions.filter(x => x !== pos)
                                : [...p.excludedPositions, pos],
                            })}
                            className={`px-2 py-1 rounded text-xs border transition-colors ${
                              excluded
                                ? 'bg-red-50 border-red-300 text-red-700 line-through'
                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {pos}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {p.lockedPosition && (
                  <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <Check size={11} className="text-green-600" />
                    Takes {p.lockedPosition} whenever they&apos;re on the field, and no other position.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
