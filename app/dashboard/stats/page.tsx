'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import {
  BarChart3, Plus, Trophy, TrendingUp, ChevronRight, Calendar,
  Star, Target, Zap, Award, Edit2, Trash2, ChevronDown, ChevronUp,
  Users, Hash, X, Save, Loader2
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────

interface Game {
  id: string
  team_id: string
  game_date: string
  opponent: string | null
  home_away: string | null
  team_score: number | null
  opponent_score: number | null
  result: string | null
  game_type: string | null
  location: string | null
  notes: string | null
}

interface PlayerSeasonStats {
  team_player_id: string
  player_id: string
  player_name: string
  jersey_number: string | null
  games_played: number
  total_ab: number
  total_hits: number
  total_singles: number
  total_doubles: number
  total_triples: number
  total_hr: number
  total_rbi: number
  total_runs: number
  total_walks: number
  total_strikeouts: number
  total_hbp: number
  total_sb: number
  total_cs: number
  batting_avg: number
  obp: number
  slg: number
  total_putouts: number
  total_assists: number
  total_errors: number
}

interface RosterPlayer {
  id: string
  player: { id: string; name: string; jersey_number: string | null }
}

interface PlayerStatEntry {
  team_player_id: string
  player_name: string
  jersey_number: string | null
  at_bats: number | null
  hits: number | null
  singles: number | null
  doubles: number | null
  triples: number | null
  home_runs: number | null
  rbi: number | null
  runs: number | null
  walks: number | null
  strikeouts: number | null
  hbp: number | null
  sac: number | null
  stolen_bases: number | null
  caught_stealing: number | null
  putouts: number | null
  assists: number | null
  errors: number | null
  innings_pitched: number | null
  pitching_hits: number | null
  pitching_runs: number | null
  earned_runs: number | null
  pitching_strikeouts: number | null
  pitching_walks: number | null
  pitches_thrown: number | null
  game_notes: string | null
  expanded: boolean
}

// ── Main Component ─────────────────────────────────────

export default function StatsPage() {
  const supabase = createClientComponentClient()
  const [teamId, setTeamId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [games, setGames] = useState<Game[]>([])
  const [leaderboard, setLeaderboard] = useState<PlayerSeasonStats[]>([])
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [activeTab, setActiveTab] = useState<'games' | 'leaderboard' | 'log'>('games')
  const [showNewGame, setShowNewGame] = useState(false)
  const [editingGameId, setEditingGameId] = useState<string | null>(null)

  // ── Load Team ──

  useEffect(() => {
    const loadTeam = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!coach) return

      const { data: teams } = await supabase
        .from('teams')
        .select('id')
        .eq('coach_id', coach.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (teams && teams.length > 0) {
        setTeamId(teams[0].id)
      }
      setLoading(false)
    }
    loadTeam()
  }, [supabase])

  // ── Load Data ──

  const loadData = useCallback(async () => {
    if (!teamId) return

    const res = await fetch(`/api/stats?teamId=${teamId}`)
    const data = await res.json()
    setGames(data.games || [])
    setLeaderboard(data.leaderboard || [])

    // Load roster
    const { data: rosterData } = await supabase
      .from('team_players')
      .select('id, player:players(id, name, jersey_number)')
      .eq('team_id', teamId)
      .order('player(name)')

    setRoster(rosterData as any || [])
  }, [teamId, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Delete Game ──

  const handleDeleteGame = async (gameId: string) => {
    if (!confirm('Delete this game and all its stats?')) return
    await fetch(`/api/stats?gameId=${gameId}`, { method: 'DELETE' })
    loadData()
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-red-600" size={32} />
      </div>
    )
  }

  // Season record
  const wins = games.filter(g => g.result === 'win').length
  const losses = games.filter(g => g.result === 'loss').length
  const ties = games.filter(g => g.result === 'tie').length

  return (
    <div className="max-w-4xl mx-auto px-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stats</h1>
          {games.length > 0 && (
            <p className="text-sm text-slate-500 mt-0.5">
              {wins}-{losses}{ties > 0 ? `-${ties}` : ''} · {games.length} game{games.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => { setShowNewGame(true); setEditingGameId(null) }}
          className="flex items-center gap-1.5 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
        >
          <Plus size={16} />
          Log Game
        </button>
      </div>

      {/* Quick Stats Bar */}
      {leaderboard.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl p-3 border border-slate-200 text-center">
            <div className="text-xs text-slate-500 mb-1">Team AVG</div>
            <div className="text-lg font-bold text-slate-900">
              {(leaderboard.reduce((s, p) => s + p.total_hits, 0) /
                Math.max(leaderboard.reduce((s, p) => s + p.total_ab, 0), 1)).toFixed(3).replace('0.', '.')}
            </div>
          </div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 text-center">
            <div className="text-xs text-slate-500 mb-1">Total Runs</div>
            <div className="text-lg font-bold text-slate-900">
              {leaderboard.reduce((s, p) => s + p.total_runs, 0)}
            </div>
          </div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 text-center">
            <div className="text-xs text-slate-500 mb-1">Total HR</div>
            <div className="text-lg font-bold text-slate-900">
              {leaderboard.reduce((s, p) => s + p.total_hr, 0)}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
        {(['games', 'leaderboard'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'games' ? 'Game Log' : 'Leaderboard'}
          </button>
        ))}
      </div>

      {/* Game Log Tab */}
      {activeTab === 'games' && (
        <div className="space-y-2">
          {games.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <BarChart3 size={48} className="mx-auto mb-3 opacity-50" />
              <p className="font-medium">No games logged yet</p>
              <p className="text-sm mt-1">Tap "Log Game" to get started</p>
            </div>
          ) : (
            games.map(game => (
              <div key={game.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        game.result === 'win' ? 'bg-green-100 text-green-700' :
                        game.result === 'loss' ? 'bg-red-100 text-red-700' :
                        game.result === 'tie' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {game.result ? game.result.charAt(0).toUpperCase() : '—'}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {game.opponent || 'Unknown'}
                      </span>
                      {game.team_score !== null && game.opponent_score !== null && (
                        <span className="text-sm text-slate-600">
                          {game.team_score}-{game.opponent_score}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <Calendar size={12} />
                      {new Date(game.game_date + 'T12:00:00').toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                      {game.game_type && game.game_type !== 'regular' && (
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 capitalize">
                          {game.game_type}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingGameId(game.id); setShowNewGame(true) }}
                      className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteGame(game.id)}
                      className="p-2 text-slate-400 hover:text-red-500 rounded-lg"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Leaderboard Tab */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-2">
          {leaderboard.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Trophy size={48} className="mx-auto mb-3 opacity-50" />
              <p className="font-medium">No stats yet</p>
              <p className="text-sm mt-1">Log your first game to see leaderboard</p>
            </div>
          ) : (
            <>
              {/* Batting Leaders */}
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider px-1">
                Batting Leaders
              </h3>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[1fr_48px_48px_48px_48px_48px] gap-0 px-3 py-2 border-b border-slate-100 text-xs font-medium text-slate-400">
                  <span>Player</span>
                  <span className="text-center">AVG</span>
                  <span className="text-center">H</span>
                  <span className="text-center">RBI</span>
                  <span className="text-center">HR</span>
                  <span className="text-center">OPS</span>
                </div>
                {leaderboard
                  .filter(p => p.total_ab > 0)
                  .sort((a, b) => b.batting_avg - a.batting_avg)
                  .map((player, i) => (
                    <div
                      key={player.team_player_id}
                      className={`grid grid-cols-[1fr_48px_48px_48px_48px_48px] gap-0 px-3 py-2.5 items-center ${
                        i % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                      } hover:bg-red-50 cursor-pointer transition-colors`}
                      onClick={() => {
                        window.location.href = `/dashboard/stats/player/${player.team_player_id}?teamId=${teamId}`
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {i === 0 && <Trophy size={14} className="text-yellow-500 flex-shrink-0" />}
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {player.jersey_number ? `#${player.jersey_number} ` : ''}{player.player_name}
                        </span>
                      </div>
                      <span className="text-sm text-center font-mono font-semibold text-slate-900">
                        {player.batting_avg.toFixed(3).replace('0.', '.')}
                      </span>
                      <span className="text-sm text-center text-slate-700">{player.total_hits}</span>
                      <span className="text-sm text-center text-slate-700">{player.total_rbi}</span>
                      <span className="text-sm text-center text-slate-700">{player.total_hr}</span>
                      <span className="text-sm text-center font-mono text-slate-600">
                        {(player.obp + player.slg).toFixed(3).replace(/^0/, '')}
                      </span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* New/Edit Game Modal */}
      {showNewGame && (
        <GameEntryModal
          teamId={teamId!}
          roster={roster}
          gameId={editingGameId}
          onClose={() => { setShowNewGame(false); setEditingGameId(null) }}
          onSaved={() => { setShowNewGame(false); setEditingGameId(null); loadData() }}
        />
      )}
    </div>
  )
}

// ── Game Entry Modal ────────────────────────────────────

function GameEntryModal({
  teamId, roster, gameId, onClose, onSaved
}: {
  teamId: string
  roster: RosterPlayer[]
  gameId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [loadingGame, setLoadingGame] = useState(!!gameId)
  const [step, setStep] = useState<'game' | 'stats'>('game')
  const [showFielding, setShowFielding] = useState(false)
  const [showPitching, setShowPitching] = useState(false)
  const [showAdvancedBatting, setShowAdvancedBatting] = useState(false)

  // Game fields
  const [gameDate, setGameDate] = useState(new Date().toISOString().split('T')[0])
  const [opponent, setOpponent] = useState('')
  const [homeAway, setHomeAway] = useState<string | null>(null)
  const [teamScore, setTeamScore] = useState<string>('')
  const [opponentScore, setOpponentScore] = useState<string>('')
  const [gameType, setGameType] = useState('regular')
  const [location, setLocation] = useState('')
  const [gameNotes, setGameNotes] = useState('')

  // Player stats
  const [playerStats, setPlayerStats] = useState<PlayerStatEntry[]>(() =>
    roster.map(r => ({
      team_player_id: r.id,
      player_name: (r.player as any)?.name || 'Player',
      jersey_number: (r.player as any)?.jersey_number || null,
      at_bats: null, hits: null, singles: null, doubles: null, triples: null,
      home_runs: null, rbi: null, runs: null, walks: null, strikeouts: null,
      hbp: null, sac: null, stolen_bases: null, caught_stealing: null,
      putouts: null, assists: null, errors: null,
      innings_pitched: null, pitching_hits: null, pitching_runs: null,
      earned_runs: null, pitching_strikeouts: null, pitching_walks: null,
      pitches_thrown: null, game_notes: null, expanded: false,
    }))
  )

  // Load existing game for editing
  useEffect(() => {
    if (!gameId) return
    const loadGame = async () => {
      const res = await fetch(`/api/stats?gameId=${gameId}`)
      const data = await res.json()
      if (data.game) {
        setGameDate(data.game.game_date)
        setOpponent(data.game.opponent || '')
        setHomeAway(data.game.home_away)
        setTeamScore(data.game.team_score?.toString() || '')
        setOpponentScore(data.game.opponent_score?.toString() || '')
        setGameType(data.game.game_type || 'regular')
        setLocation(data.game.location || '')
        setGameNotes(data.game.notes || '')
      }
      if (data.stats && data.stats.length > 0) {
        setPlayerStats(prev => prev.map(ps => {
          const existing = data.stats.find((s: any) => s.team_player_id === ps.team_player_id)
          if (existing) {
            return { ...ps, ...existing, expanded: false }
          }
          return ps
        }))
      }
      setLoadingGame(false)
    }
    loadGame()
  }, [gameId])

  const updatePlayerStat = (teamPlayerId: string, field: string, value: any) => {
    setPlayerStats(prev => prev.map(ps =>
      ps.team_player_id === teamPlayerId ? { ...ps, [field]: value } : ps
    ))
  }

  // Auto-calculate singles from hits - (2B + 3B + HR)
  const autoCalcSingles = (ps: PlayerStatEntry): number | null => {
    if (ps.hits === null) return null
    const extras = (ps.doubles || 0) + (ps.triples || 0) + (ps.home_runs || 0)
    return Math.max(0, (ps.hits || 0) - extras)
  }

  // Determine result from score
  const getResult = (): string | null => {
    const ts = parseInt(teamScore)
    const os = parseInt(opponentScore)
    if (isNaN(ts) || isNaN(os)) return null
    if (ts > os) return 'win'
    if (ts < os) return 'loss'
    return 'tie'
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const gamePayload = {
        team_id: teamId,
        game_date: gameDate,
        opponent: opponent || null,
        home_away: homeAway,
        team_score: teamScore ? parseInt(teamScore) : null,
        opponent_score: opponentScore ? parseInt(opponentScore) : null,
        result: getResult(),
        game_type: gameType,
        location: location || null,
        notes: gameNotes || null,
      }

      // Auto-calculate singles for each player
      const statsPayload = playerStats
        .filter(ps => {
          // Only include players that have at least one stat entered
          return ps.at_bats !== null || ps.hits !== null || ps.walks !== null ||
            ps.runs !== null || ps.rbi !== null || ps.home_runs !== null ||
            ps.stolen_bases !== null || ps.game_notes
        })
        .map(ps => ({
          ...ps,
          singles: autoCalcSingles(ps),
          game_id: gameId, // for PUT
        }))

      if (gameId) {
        await fetch('/api/stats', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            game: { ...gamePayload, id: gameId },
            playerStats: statsPayload
          })
        })
      } else {
        await fetch('/api/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            game: gamePayload,
            playerStats: statsPayload
          })
        })
      }

      onSaved()
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loadingGame) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
        <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl p-6">
          <Loader2 className="animate-spin mx-auto text-red-600" size={32} />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-900">
            {gameId ? 'Edit Game' : 'Log Game'}
          </h2>
          <div className="flex items-center gap-2">
            {step === 'stats' && (
              <button
                onClick={() => setStep('game')}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Back
              </button>
            )}
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 flex-shrink-0">
          <div className={`flex items-center gap-1.5 text-xs font-medium ${step === 'game' ? 'text-red-600' : 'text-slate-400'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 'game' ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1</div>
            Game Info
          </div>
          <ChevronRight size={14} className="text-slate-300" />
          <div className={`flex items-center gap-1.5 text-xs font-medium ${step === 'stats' ? 'text-red-600' : 'text-slate-400'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 'stats' ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
            Player Stats
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {step === 'game' && (
            <div className="space-y-4">
              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={gameDate}
                  onChange={e => setGameDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              {/* Opponent */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Opponent</label>
                <input
                  type="text"
                  value={opponent}
                  onChange={e => setOpponent(e.target.value)}
                  placeholder="e.g. Tigers"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              {/* Score */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Our Score</label>
                  <input
                    type="number"
                    value={teamScore}
                    onChange={e => setTeamScore(e.target.value)}
                    placeholder="—"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Their Score</label>
                  <input
                    type="number"
                    value={opponentScore}
                    onChange={e => setOpponentScore(e.target.value)}
                    placeholder="—"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>
              </div>

              {/* Home/Away + Game Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Home/Away</label>
                  <select
                    value={homeAway || ''}
                    onChange={e => setHomeAway(e.target.value || null)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="">—</option>
                    <option value="home">Home</option>
                    <option value="away">Away</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={gameType}
                    onChange={e => setGameType(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="regular">Regular</option>
                    <option value="tournament">Tournament</option>
                    <option value="playoff">Playoff</option>
                    <option value="scrimmage">Scrimmage</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Game Notes</label>
                <textarea
                  value={gameNotes}
                  onChange={e => setGameNotes(e.target.value)}
                  placeholder="Rain delay, short game, great defensive effort..."
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                />
              </div>
            </div>
          )}

          {step === 'stats' && (
            <div className="space-y-3">
              {/* Toggle sections */}
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => setShowAdvancedBatting(!showAdvancedBatting)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    showAdvancedBatting ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {showAdvancedBatting ? '−' : '+'} Extra-Base Hits
                </button>
                <button
                  onClick={() => setShowFielding(!showFielding)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    showFielding ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {showFielding ? '−' : '+'} Fielding
                </button>
                <button
                  onClick={() => setShowPitching(!showPitching)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    showPitching ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {showPitching ? '−' : '+'} Pitching
                </button>
              </div>

              {/* Player Stat Cards */}
              {playerStats.map(ps => (
                <div key={ps.team_player_id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Player Header */}
                  <button
                    onClick={() => updatePlayerStat(ps.team_player_id, 'expanded', !ps.expanded)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-slate-800 text-white rounded-full flex items-center justify-center text-xs font-bold">
                        {ps.jersey_number || '?'}
                      </div>
                      <span className="text-sm font-medium text-slate-900">{ps.player_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {ps.hits !== null && (
                        <span className="text-xs text-slate-500">
                          {ps.hits}-{ps.at_bats || 0}
                        </span>
                      )}
                      {ps.expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </button>

                  {/* Expanded Stats */}
                  {ps.expanded && (
                    <div className="px-3 pb-3 border-t border-slate-100 pt-3 space-y-3">
                      {/* Core Batting - Compact Grid */}
                      <div className="grid grid-cols-4 gap-2">
                        <StatInput label="AB" value={ps.at_bats} onChange={v => updatePlayerStat(ps.team_player_id, 'at_bats', v)} />
                        <StatInput label="H" value={ps.hits} onChange={v => updatePlayerStat(ps.team_player_id, 'hits', v)} />
                        <StatInput label="R" value={ps.runs} onChange={v => updatePlayerStat(ps.team_player_id, 'runs', v)} />
                        <StatInput label="RBI" value={ps.rbi} onChange={v => updatePlayerStat(ps.team_player_id, 'rbi', v)} />
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <StatInput label="BB" value={ps.walks} onChange={v => updatePlayerStat(ps.team_player_id, 'walks', v)} />
                        <StatInput label="K" value={ps.strikeouts} onChange={v => updatePlayerStat(ps.team_player_id, 'strikeouts', v)} />
                        <StatInput label="SB" value={ps.stolen_bases} onChange={v => updatePlayerStat(ps.team_player_id, 'stolen_bases', v)} />
                        <StatInput label="HBP" value={ps.hbp} onChange={v => updatePlayerStat(ps.team_player_id, 'hbp', v)} />
                      </div>

                      {/* Advanced Batting */}
                      {showAdvancedBatting && (
                        <div>
                          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Extra-Base Hits</div>
                          <div className="grid grid-cols-4 gap-2">
                            <StatInput label="2B" value={ps.doubles} onChange={v => updatePlayerStat(ps.team_player_id, 'doubles', v)} />
                            <StatInput label="3B" value={ps.triples} onChange={v => updatePlayerStat(ps.team_player_id, 'triples', v)} />
                            <StatInput label="HR" value={ps.home_runs} onChange={v => updatePlayerStat(ps.team_player_id, 'home_runs', v)} />
                            <StatInput label="SAC" value={ps.sac} onChange={v => updatePlayerStat(ps.team_player_id, 'sac', v)} />
                          </div>
                        </div>
                      )}

                      {/* Fielding */}
                      {showFielding && (
                        <div>
                          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Fielding</div>
                          <div className="grid grid-cols-3 gap-2">
                            <StatInput label="PO" value={ps.putouts} onChange={v => updatePlayerStat(ps.team_player_id, 'putouts', v)} />
                            <StatInput label="A" value={ps.assists} onChange={v => updatePlayerStat(ps.team_player_id, 'assists', v)} />
                            <StatInput label="E" value={ps.errors} onChange={v => updatePlayerStat(ps.team_player_id, 'errors', v)} />
                          </div>
                        </div>
                      )}

                      {/* Pitching */}
                      {showPitching && (
                        <div>
                          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Pitching</div>
                          <div className="grid grid-cols-4 gap-2">
                            <StatInput label="IP" value={ps.innings_pitched} onChange={v => updatePlayerStat(ps.team_player_id, 'innings_pitched', v)} decimal />
                            <StatInput label="K" value={ps.pitching_strikeouts} onChange={v => updatePlayerStat(ps.team_player_id, 'pitching_strikeouts', v)} />
                            <StatInput label="BB" value={ps.pitching_walks} onChange={v => updatePlayerStat(ps.team_player_id, 'pitching_walks', v)} />
                            <StatInput label="PC" value={ps.pitches_thrown} onChange={v => updatePlayerStat(ps.team_player_id, 'pitches_thrown', v)} />
                          </div>
                          <div className="grid grid-cols-4 gap-2 mt-2">
                            <StatInput label="H" value={ps.pitching_hits} onChange={v => updatePlayerStat(ps.team_player_id, 'pitching_hits', v)} />
                            <StatInput label="R" value={ps.pitching_runs} onChange={v => updatePlayerStat(ps.team_player_id, 'pitching_runs', v)} />
                            <StatInput label="ER" value={ps.earned_runs} onChange={v => updatePlayerStat(ps.team_player_id, 'earned_runs', v)} />
                            <StatInput label="HBP" value={ps.pitching_hbp} onChange={v => updatePlayerStat(ps.team_player_id, 'pitching_hbp', v)} />
                          </div>
                        </div>
                      )}

                      {/* Per-player game notes */}
                      <div>
                        <textarea
                          value={ps.game_notes || ''}
                          onChange={e => updatePlayerStat(ps.team_player_id, 'game_notes', e.target.value || null)}
                          placeholder="Notes for this game..."
                          rows={2}
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex-shrink-0">
          {step === 'game' ? (
            <button
              onClick={() => setStep('stats')}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
            >
              Next: Player Stats <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <><Loader2 size={16} className="animate-spin" /> Saving...</>
              ) : (
                <><Save size={16} /> Save Game</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stat Input Component ────────────────────────────────

function StatInput({
  label, value, onChange, decimal
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  decimal?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-slate-400 uppercase mb-0.5 text-center">
        {label}
      </label>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        step={decimal ? '0.1' : '1'}
        min="0"
        value={value ?? ''}
        onChange={e => {
          const v = e.target.value
          onChange(v === '' ? null : (decimal ? parseFloat(v) : parseInt(v)))
        }}
        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:ring-2 focus:ring-red-500 focus:border-red-500"
      />
    </div>
  )
}
