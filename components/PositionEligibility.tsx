'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shield, Loader2, AlertCircle, RotateCcw, Check } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'

// Who can play the positions where being wrong costs you.
//
// This was always a TEAM setting — the rows are keyed by roster spot, not by
// game — but it lived inside the lineup builder, which made it look like
// something you redo before every game. Nobody wants to flag nine kids for
// catcher every Saturday.
//
// So it is one component with two modes:
//
//   Team mode      — the standing answer. Set once, changed when a kid learns
//                    a position.
//   Game mode      — tonight only. A row here overrides the team setting for
//                    ONE game, which is the case the builder could not express:
//                    you're trying a kid at catcher this week without promising
//                    he catches from now on.
//
// Game mode never writes to the team setting. That separation is the whole
// point — an experiment must not quietly become policy.

// Only the positions where a kid who can't handle it costs runs or gets hurt.
// A coach who has to flag all nine for everyone never uses this at all.
const KEY_POSITIONS = ['C', 'P', '1B']

interface RosterPlayer {
  id: string
  player: { id: string; name: string; jersey_number?: string | null }
}

interface Props {
  teamId: string
  players: RosterPlayer[]
  // Present in game mode. Absent means editing the team's standing answer.
  gameId?: string | null
  // Shown above the grid in game mode.
  gameLabel?: string | null
  onReviewed?: () => void
}

interface Row { team_player_id: string; position: string; eligible: boolean; id?: string }

export function PositionEligibility({ teamId, players, gameId, gameLabel, onReviewed }: Props) {
  const supabase = createSupabaseComponentClient()

  const [team, setTeam] = useState<Row[]>([])
  const [tonight, setTonight] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)

  const inGameMode = !!gameId

  const load = useCallback(async () => {
    if (players.length === 0) { setLoading(false); return }
    try {
      const ids = players.map(p => p.id)
      const [{ data: t }, over] = await Promise.all([
        supabase.from('position_eligibility').select('*').in('team_player_id', ids),
        gameId
          ? supabase.from('game_position_eligibility').select('*').eq('game_id', gameId)
          : Promise.resolve({ data: [] as any[], error: null }),
      ])
      setTeam((t || []) as Row[])
      setTonight(((over as any).data || []) as Row[])
      if ((over as any).error) throw (over as any).error
    } catch (e: any) {
      // A missing override table is a migration away, not a broken screen —
      // the team settings still work and still show.
      if (/game_position_eligibility/.test(String(e?.message || ''))) {
        setError('Run migration 031 to set eligibility for a single game. Your team settings below still work.')
      }
    } finally {
      setLoading(false)
    }
  }, [supabase, players, gameId])

  useEffect(() => { load() }, [load])

  // The team's answer, and then tonight's if there is one.
  const teamSays = (tp: string, pos: string): boolean =>
    team.find(r => r.team_player_id === tp && r.position === pos)?.eligible ?? false

  const override = (tp: string, pos: string): boolean | null => {
    const r = tonight.find(x => x.team_player_id === tp && x.position === pos)
    return r ? r.eligible : null
  }

  const effective = (tp: string, pos: string): boolean => {
    const o = override(tp, pos)
    return o === null ? teamSays(tp, pos) : o
  }

  // ── Writing ────────────────────────────────────────────

  const toggleTeam = async (tp: string, pos: string) => {
    const existing = team.find(r => r.team_player_id === tp && r.position === pos)
    const next = !(existing?.eligible ?? false)
    // Optimistic: this is a checkbox, and a coach tapping down a column should
    // not wait for a round trip between each one.
    setTeam(prev => existing
      ? prev.map(r => r === existing ? { ...r, eligible: next } : r)
      : [...prev, { team_player_id: tp, position: pos, eligible: next }])
    try {
      if (existing?.id) {
        const { error } = await supabase
          .from('position_eligibility').update({ eligible: next }).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('position_eligibility')
          .insert({ team_player_id: tp, position: pos, eligible: next })
          .select().single()
        if (error) throw error
        if (data) setTeam(prev => prev.map(r =>
          r.team_player_id === tp && r.position === pos ? (data as Row) : r))
      }
    } catch (e: any) {
      setError(e.message || 'That did not save.')
      load()
    }
  }

  const toggleTonight = async (tp: string, pos: string) => {
    if (!gameId) return
    const next = !effective(tp, pos)
    // Back to the team's answer rather than an override that happens to match:
    // a row that says the same thing as the default would silently freeze this
    // kid's eligibility at tonight's value if the team setting later changed.
    const backToDefault = next === teamSays(tp, pos)

    setTonight(prev => {
      const without = prev.filter(r => !(r.team_player_id === tp && r.position === pos))
      return backToDefault ? without : [...without, { team_player_id: tp, position: pos, eligible: next }]
    })

    try {
      if (backToDefault) {
        const { error } = await supabase
          .from('game_position_eligibility').delete()
          .eq('game_id', gameId).eq('team_player_id', tp).eq('position', pos)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('game_position_eligibility')
          .upsert({ game_id: gameId, team_player_id: tp, position: pos, eligible: next },
                  { onConflict: 'game_id,team_player_id,position' })
        if (error) throw error
      }
    } catch (e: any) {
      setError(e.message || 'That did not save.')
      load()
    }
  }

  const clearTonight = async () => {
    if (!gameId) return
    setTonight([])
    await supabase.from('game_position_eligibility').delete().eq('game_id', gameId)
  }

  const markReviewed = async () => {
    setReviewed(true)
    if (gameId) {
      await supabase
        .from('games')
        .update({ eligibility_reviewed_at: new Date().toISOString() })
        .eq('id', gameId)
    }
    onReviewed?.()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
        <Loader2 className="animate-spin" size={15} /> Loading eligibility…
      </div>
    )
  }

  const changedCount = tonight.length

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Shield size={18} className="text-gray-400" />
            Position Eligibility
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {inGameMode ? (
              <>
                This is your <strong>team setting</strong>, carried over from game to game.
                Change anything below and it applies to{' '}
                <strong>{gameLabel || 'this game'} only</strong> — your team setting stays as it is.
              </>
            ) : (
              <>
                A team setting, not something you redo every game. Flag who can handle
                catcher, pitcher and first base — the lineup builder won&apos;t put anyone
                else there.
              </>
            )}
          </p>
        </div>
        {inGameMode && (
          <button
            onClick={markReviewed}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${
              reviewed
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Check size={15} /> {reviewed ? 'Looks right' : 'Looks right'}
          </button>
        )}
      </div>

      {error && (
        <div className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
          <span>{error}</span>
        </div>
      )}

      {inGameMode && changedCount > 0 && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <p className="text-sm text-blue-900">
            {changedCount} change{changedCount === 1 ? '' : 's'} for this game only.
          </p>
          <button
            onClick={clearTonight}
            className="shrink-0 flex items-center gap-1 text-sm font-medium text-blue-700 underline"
          >
            <RotateCcw size={13} /> Back to team settings
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 pr-4 text-sm font-medium text-gray-700">Player</th>
              {KEY_POSITIONS.map(pos => (
                <th key={pos} className="px-4 py-2 text-center text-sm font-medium text-gray-700">{pos}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(p => (
              <tr key={p.id} className="border-b border-gray-100">
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-gray-900">{p.player.name}</div>
                  {p.player.jersey_number && (
                    <span className="text-xs text-gray-500">#{p.player.jersey_number}</span>
                  )}
                </td>
                {KEY_POSITIONS.map(pos => {
                  const on = effective(p.id, pos)
                  const isOverridden = inGameMode && override(p.id, pos) !== null
                  return (
                    <td key={pos} className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => inGameMode ? toggleTonight(p.id, pos) : toggleTeam(p.id, pos)}
                        className={`w-9 h-9 rounded-full border-2 transition-all relative ${
                          on
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'bg-white border-gray-300 text-gray-300 hover:border-gray-400'
                        } ${isOverridden ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}
                        aria-label={`${p.player.name} at ${pos}`}
                      >
                        {on ? '✓' : ''}
                        {/* A ringed cell is a departure from the team setting.
                            Without the marker a coach cannot tell which of
                            tonight's answers were theirs. */}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Players with nothing flagged can still play every other position — 2B, 3B, SS and
        the outfield are open to everyone.
        {inGameMode && changedCount > 0 && ' Ringed circles are tonight-only.'}
      </p>
    </div>
  )
}
