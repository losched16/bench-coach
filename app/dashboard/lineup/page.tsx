'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, Calendar, Shield, RotateCcw, Save, Trash2, ChevronDown, ChevronUp, Users, AlertCircle } from 'lucide-react'

// Types
interface Player {
  id: string
  player: {
    id: string
    name: string
    jersey_number: string | null
  }
  positions: string[]
  hitting_level: number | null
  throwing_level: number | null
  fielding_level: number | null
}

interface PositionEligibility {
  id: string
  team_player_id: string
  position: string
  eligible: boolean
}

interface GameLineup {
  id: string
  game_date: string
  opponent: string | null
  innings: number
  pitching_type: string
  field_positions: number
  everyone_bats: boolean
  notes: string | null
  status: string
  created_at: string
}

interface Assignment {
  team_player_id: string
  name: string
  position: string
}

interface BenchPlayer {
  team_player_id: string
  name: string
}

interface GeneratedLineup {
  batting_order: Array<{ team_player_id: string; name: string; order: number }>
  field_assignments: Record<string, Assignment[]>
  bench_by_inning: Record<string, BenchPlayer[]>
  notes: string
}

// Position colors for the grid
const POSITION_COLORS: Record<string, string> = {
  'P': 'bg-red-100 text-red-800 border-red-200',
  'C': 'bg-orange-100 text-orange-800 border-orange-200',
  '1B': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  '2B': 'bg-green-100 text-green-800 border-green-200',
  '3B': 'bg-teal-100 text-teal-800 border-teal-200',
  'SS': 'bg-blue-100 text-blue-800 border-blue-200',
  'LF': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'CF': 'bg-purple-100 text-purple-800 border-purple-200',
  'LCF': 'bg-purple-100 text-purple-800 border-purple-200',
  'RCF': 'bg-violet-100 text-violet-800 border-violet-200',
  'RF': 'bg-pink-100 text-pink-800 border-pink-200',
  'EH': 'bg-gray-100 text-gray-800 border-gray-200',
  'BENCH': 'bg-gray-50 text-gray-500 border-gray-200',
}

const KEY_POSITIONS = ['C', 'P', '1B']

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function LineupPage() {
  // State
  const [players, setPlayers] = useState<Player[]>([])
  const [eligibility, setEligibility] = useState<PositionEligibility[]>([])
  const [savedLineups, setSavedLineups] = useState<GameLineup[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Setup form state
  const [showSetup, setShowSetup] = useState(false)
  const [gameDate, setGameDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [innings, setInnings] = useState(6)
  const [pitchingType, setPitchingType] = useState('coach_pitch')
  const [fieldPositions, setFieldPositions] = useState(10)
  const [everyoneBats, setEveryoneBats] = useState(true)

  // Eligibility editor state
  const [showEligibility, setShowEligibility] = useState(false)

  // Generated lineup state
  const [generatedLineup, setGeneratedLineup] = useState<GeneratedLineup | null>(null)
  const [activeInning, setActiveInning] = useState(1)

  // View saved lineup state
  const [viewingLineup, setViewingLineup] = useState<GameLineup | null>(null)
  const [viewingAssignments, setViewingAssignments] = useState<any[]>([])

  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadData()
    }
  }, [teamId])

  const loadData = async () => {
    try {
      // Load roster
      const { data: rosterData } = await supabase
        .from('team_players')
        .select(`*, player:players(*)`)
        .eq('team_id', teamId)
        .order('player(name)')

      if (rosterData) setPlayers(rosterData as any)

      // Load eligibility
      if (rosterData && rosterData.length > 0) {
        const ids = rosterData.map(r => r.id)
        const { data: eligData } = await supabase
          .from('position_eligibility')
          .select('*')
          .in('team_player_id', ids)

        if (eligData) setEligibility(eligData)
      }

      // Load saved lineups
      const { data: lineups } = await supabase
        .from('game_lineups')
        .select('*')
        .eq('team_id', teamId)
        .order('game_date', { ascending: false })
        .limit(20)

      if (lineups) setSavedLineups(lineups)
    } catch (error) {
      console.error('Error loading lineup data:', error)
    } finally {
      setLoading(false)
    }
  }

  // ── Eligibility Management ──────────────────────────────────

  const isEligible = (teamPlayerId: string, position: string): boolean => {
    const entry = eligibility.find(
      e => e.team_player_id === teamPlayerId && e.position === position
    )
    return entry?.eligible ?? false
  }

  const toggleEligibility = async (teamPlayerId: string, position: string) => {
    const existing = eligibility.find(
      e => e.team_player_id === teamPlayerId && e.position === position
    )

    try {
      if (existing) {
        // Toggle it
        const newValue = !existing.eligible
        await supabase
          .from('position_eligibility')
          .update({ eligible: newValue })
          .eq('id', existing.id)

        setEligibility(prev =>
          prev.map(e => e.id === existing.id ? { ...e, eligible: newValue } : e)
        )
      } else {
        // Create new entry (default to eligible)
        const { data } = await supabase
          .from('position_eligibility')
          .insert({
            team_player_id: teamPlayerId,
            position: position,
            eligible: true,
          })
          .select()
          .single()

        if (data) {
          setEligibility(prev => [...prev, data])
        }
      }
    } catch (error) {
      console.error('Error updating eligibility:', error)
    }
  }

  // ── Lineup Generation ──────────────────────────────────────

  const handleGenerate = async () => {
    if (!teamId) return

    setGenerating(true)
    setGeneratedLineup(null)

    try {
      const response = await fetch('/api/lineup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          innings,
          pitchingType,
          fieldPositions,
          everyoneBats,
          opponent: opponent || null,
          gameDate: gameDate || null,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to generate lineup')
      }

      const data = await response.json()
      setGeneratedLineup(data)
      setActiveInning(1)
      setShowSetup(false)
    } catch (error) {
      console.error('Error generating lineup:', error)
      alert('Failed to generate lineup. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  // ── Save Lineup ──────────────────────────────────────────

  const handleSaveLineup = async () => {
    if (!teamId || !generatedLineup) return

    setSaving(true)

    try {
      // Create the game lineup record
      const { data: lineup, error: lineupError } = await supabase
        .from('game_lineups')
        .insert({
          team_id: teamId,
          game_date: gameDate || new Date().toISOString().split('T')[0],
          opponent: opponent || null,
          innings,
          pitching_type: pitchingType,
          field_positions: fieldPositions,
          everyone_bats: everyoneBats,
          notes: generatedLineup.notes,
          status: 'draft',
        })
        .select()
        .single()

      if (lineupError) throw lineupError

      // Build all assignments
      const assignments: any[] = []

      for (const [inningStr, fieldPlayers] of Object.entries(generatedLineup.field_assignments)) {
        const inning = parseInt(inningStr)
        for (const fp of fieldPlayers) {
          // Find batting order for this player
          const batterInfo = generatedLineup.batting_order.find(
            b => b.team_player_id === fp.team_player_id
          )
          assignments.push({
            lineup_id: lineup.id,
            team_player_id: fp.team_player_id,
            inning,
            position: fp.position,
            batting_order: batterInfo?.order || null,
          })
        }
      }

      // Add bench assignments
      for (const [inningStr, benchPlayers] of Object.entries(generatedLineup.bench_by_inning)) {
        const inning = parseInt(inningStr)
        for (const bp of benchPlayers) {
          const batterInfo = generatedLineup.batting_order.find(
            b => b.team_player_id === bp.team_player_id
          )
          assignments.push({
            lineup_id: lineup.id,
            team_player_id: bp.team_player_id,
            inning,
            position: 'BENCH',
            batting_order: batterInfo?.order || null,
          })
        }
      }

      if (assignments.length > 0) {
        const { error: assignError } = await supabase
          .from('lineup_assignments')
          .insert(assignments)

        if (assignError) throw assignError
      }

      // Refresh saved lineups
      await loadData()
      alert('Lineup saved!')
    } catch (error) {
      console.error('Error saving lineup:', error)
      alert('Failed to save lineup')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete Lineup ──────────────────────────────────────────

  const handleDeleteLineup = async (lineupId: string) => {
    if (!confirm('Delete this lineup? This cannot be undone.')) return

    try {
      await supabase.from('game_lineups').delete().eq('id', lineupId)
      setSavedLineups(prev => prev.filter(l => l.id !== lineupId))
      if (viewingLineup?.id === lineupId) {
        setViewingLineup(null)
        setViewingAssignments([])
      }
    } catch (error) {
      console.error('Error deleting lineup:', error)
    }
  }

  // ── View Saved Lineup ──────────────────────────────────────

  const handleViewLineup = async (lineup: GameLineup) => {
    try {
      const { data: assignments } = await supabase
        .from('lineup_assignments')
        .select(`*, team_player:team_players(*, player:players(*))`)
        .eq('lineup_id', lineup.id)
        .order('inning')

      setViewingLineup(lineup)
      setViewingAssignments(assignments || [])
      setActiveInning(1)
      setGeneratedLineup(null)
    } catch (error) {
      console.error('Error loading lineup:', error)
    }
  }

  // ── Position swap in generated lineup (manual edit) ─────────

  const swapPositions = (inning: number, playerIdA: string, playerIdB: string) => {
    if (!generatedLineup) return

    const inningStr = inning.toString()
    const fieldPlayers = [...(generatedLineup.field_assignments[inningStr] || [])]
    const benchPlayers = [...(generatedLineup.bench_by_inning[inningStr] || [])]

    const fieldIdxA = fieldPlayers.findIndex(p => p.team_player_id === playerIdA)
    const fieldIdxB = fieldPlayers.findIndex(p => p.team_player_id === playerIdB)
    const benchIdxA = benchPlayers.findIndex(p => p.team_player_id === playerIdA)
    const benchIdxB = benchPlayers.findIndex(p => p.team_player_id === playerIdB)

    // Both in field: swap positions
    if (fieldIdxA >= 0 && fieldIdxB >= 0) {
      const tempPos = fieldPlayers[fieldIdxA].position
      fieldPlayers[fieldIdxA] = { ...fieldPlayers[fieldIdxA], position: fieldPlayers[fieldIdxB].position }
      fieldPlayers[fieldIdxB] = { ...fieldPlayers[fieldIdxB], position: tempPos }
    }
    // One field, one bench: swap in/out
    else if (fieldIdxA >= 0 && benchIdxB >= 0) {
      const fieldPlayer = fieldPlayers[fieldIdxA]
      const benchPlayer = benchPlayers[benchIdxB]
      fieldPlayers[fieldIdxA] = { team_player_id: benchPlayer.team_player_id, name: benchPlayer.name, position: fieldPlayer.position }
      benchPlayers[benchIdxB] = { team_player_id: fieldPlayer.team_player_id, name: fieldPlayer.name }
    }
    else if (benchIdxA >= 0 && fieldIdxB >= 0) {
      const benchPlayer = benchPlayers[benchIdxA]
      const fieldPlayer = fieldPlayers[fieldIdxB]
      fieldPlayers[fieldIdxB] = { team_player_id: benchPlayer.team_player_id, name: benchPlayer.name, position: fieldPlayer.position }
      benchPlayers[benchIdxA] = { team_player_id: fieldPlayer.team_player_id, name: fieldPlayer.name }
    }

    setGeneratedLineup({
      ...generatedLineup,
      field_assignments: {
        ...generatedLineup.field_assignments,
        [inningStr]: fieldPlayers,
      },
      bench_by_inning: {
        ...generatedLineup.bench_by_inning,
        [inningStr]: benchPlayers,
      },
    })
  }

  // ── Drag state for swaps ─────────────────────────────────

  const [dragPlayer, setDragPlayer] = useState<string | null>(null)

  // ── Render Helpers ──────────────────────────────────────

  const getPositionStyle = (position: string) => {
    return POSITION_COLORS[position] || 'bg-gray-100 text-gray-700 border-gray-200'
  }

  // ── Loading State ───────────────────────────────────────

  if (loading) {
    return <div className="text-gray-600">Loading lineup data...</div>
  }

  // ── No Players Warning ──────────────────────────────────

  if (players.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Game Day Lineup</h2>
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Users className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600 mb-2">Add players to your roster first</p>
          <p className="text-sm text-gray-500">You need at least 9 players to generate a lineup</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Game Day Lineup</h2>
        <div className="flex space-x-3">
          <button
            onClick={() => { setShowEligibility(!showEligibility); setShowSetup(false) }}
            className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Shield size={18} />
            <span>Position Eligibility</span>
          </button>
          <button
            onClick={() => { setShowSetup(!showSetup); setShowEligibility(false) }}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            <span>New Lineup</span>
          </button>
        </div>
      </div>

      {/* Position Eligibility Editor */}
      {showEligibility && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Position Eligibility</h3>
              <p className="text-sm text-gray-600 mt-1">
                Flag which players can handle key positions. The AI will only assign Catcher, Pitcher, and 1st Base to eligible players.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 pr-4 text-sm font-medium text-gray-700">Player</th>
                  {KEY_POSITIONS.map(pos => (
                    <th key={pos} className="px-4 py-3 text-center text-sm font-medium text-gray-700">{pos}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map(player => (
                  <tr key={player.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900">{player.player.name}</div>
                      {player.player.jersey_number && (
                        <span className="text-xs text-gray-500">#{player.player.jersey_number}</span>
                      )}
                    </td>
                    {KEY_POSITIONS.map(pos => (
                      <td key={pos} className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleEligibility(player.id, pos)}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${
                            isEligible(player.id, pos)
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'bg-white border-gray-300 text-gray-300 hover:border-gray-400'
                          }`}
                        >
                          {isEligible(player.id, pos) ? '✓' : ''}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg flex items-start space-x-2">
            <AlertCircle size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-800">
              Players without any eligibility flags can play all other positions (2B, 3B, SS, OF). 
              Only flag players who are comfortable and capable at catcher, pitcher, or first base.
            </p>
          </div>
        </div>
      )}

      {/* New Lineup Setup Form */}
      {showSetup && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Game Setup</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Game Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Game Date</label>
              <input
                type="date"
                value={gameDate}
                onChange={(e) => setGameDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Opponent */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Opponent (optional)</label>
              <input
                type="text"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="e.g. Red Sox"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Innings */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Innings</label>
              <div className="flex space-x-2">
                {[4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => setInnings(n)}
                    className={`flex-1 py-2 rounded-lg border-2 font-medium transition-colors ${
                      innings === n
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Pitching Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Pitching</label>
              <select
                value={pitchingType}
                onChange={(e) => setPitchingType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="coach_pitch">Coach Pitch</option>
                <option value="machine_pitch">Machine Pitch</option>
                <option value="live_pitch">Live Pitch (Kid Pitchers)</option>
                <option value="mixed">Mixed (Some Innings Live)</option>
              </select>
            </div>

            {/* Field Positions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Players on Field</label>
              <div className="flex space-x-2">
                {[9, 10, 11].map(n => (
                  <button
                    key={n}
                    onClick={() => setFieldPositions(n)}
                    className={`flex-1 py-2 rounded-lg border-2 font-medium transition-colors ${
                      fieldPositions === n
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Everyone Bats */}
            <div className="flex items-center space-x-3 pt-6">
              <button
                onClick={() => setEveryoneBats(!everyoneBats)}
                className={`w-12 h-7 rounded-full transition-colors ${
                  everyoneBats ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    everyoneBats ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-gray-700">Everyone Bats (continuous order)</span>
            </div>
          </div>

          {/* Eligibility reminder */}
          {eligibility.length === 0 && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start space-x-2">
              <AlertCircle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-yellow-800">
                You haven't set position eligibility yet. The AI won't know which kids can play catcher or first base.{' '}
                <button
                  onClick={() => { setShowEligibility(true); setShowSetup(false) }}
                  className="underline font-medium"
                >
                  Set eligibility first
                </button>
              </p>
            </div>
          )}

          {/* Generate Button */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={() => setShowSetup(false)}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || players.length < 9}
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <RotateCcw size={18} className="animate-spin" />
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <Calendar size={18} />
                  <span>Generate Lineup</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Generated Lineup View */}
      {generatedLineup && (
        <div className="space-y-6">
          {/* Lineup Header */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Generated Lineup
                  {opponent && <span className="text-gray-600"> vs {opponent}</span>}
                </h3>
                {gameDate && (
                  <p className="text-sm text-gray-600 mt-1">{formatDate(gameDate)}</p>
                )}
                {generatedLineup.notes && (
                  <p className="text-sm text-gray-600 mt-2 italic">{generatedLineup.notes}</p>
                )}
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <RotateCcw size={16} className={generating ? 'animate-spin' : ''} />
                  <span>Regenerate</span>
                </button>
                <button
                  onClick={handleSaveLineup}
                  disabled={saving}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Save size={16} />
                  <span>{saving ? 'Saving...' : 'Save Lineup'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Batting Order */}
          <div className="bg-white rounded-lg shadow p-6">
            <h4 className="text-md font-semibold text-gray-900 mb-3">Batting Order</h4>
            <div className="flex flex-wrap gap-2">
              {generatedLineup.batting_order
                .sort((a, b) => a.order - b.order)
                .map((batter) => {
                  const player = players.find(p => p.id === batter.team_player_id)
                  return (
                    <div
                      key={batter.team_player_id}
                      className="flex items-center space-x-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <span className="text-xs font-bold text-gray-500 w-5">{batter.order}</span>
                      <span className="text-sm font-medium text-gray-900">{batter.name}</span>
                      {player?.player.jersey_number && (
                        <span className="text-xs text-gray-500">#{player.player.jersey_number}</span>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Inning Tabs */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="flex border-b border-gray-200">
              {Array.from({ length: innings }, (_, i) => i + 1).map(inning => (
                <button
                  key={inning}
                  onClick={() => setActiveInning(inning)}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    activeInning === inning
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Inning {inning}
                </button>
              ))}
            </div>

            {/* Field Assignments for Active Inning */}
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {(generatedLineup.field_assignments[activeInning.toString()] || []).map((assignment) => {
                  const player = players.find(p => p.id === assignment.team_player_id)
                  return (
                    <div
                      key={assignment.team_player_id}
                      draggable
                      onDragStart={() => setDragPlayer(assignment.team_player_id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragPlayer && dragPlayer !== assignment.team_player_id) {
                          swapPositions(activeInning, dragPlayer, assignment.team_player_id)
                        }
                        setDragPlayer(null)
                      }}
                      className={`p-3 rounded-lg border-2 cursor-move hover:shadow-md transition-all ${getPositionStyle(assignment.position)}`}
                    >
                      <div className="text-xs font-bold mb-1">{assignment.position}</div>
                      <div className="text-sm font-medium">{assignment.name}</div>
                      {player?.player.jersey_number && (
                        <div className="text-xs opacity-70">#{player.player.jersey_number}</div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Bench Players */}
              {generatedLineup.bench_by_inning[activeInning.toString()] &&
                generatedLineup.bench_by_inning[activeInning.toString()].length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-xs font-medium text-gray-500 mb-2">BENCH THIS INNING</div>
                    <div className="flex flex-wrap gap-2">
                      {generatedLineup.bench_by_inning[activeInning.toString()].map((bp) => {
                        const player = players.find(p => p.id === bp.team_player_id)
                        return (
                          <div
                            key={bp.team_player_id}
                            draggable
                            onDragStart={() => setDragPlayer(bp.team_player_id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (dragPlayer && dragPlayer !== bp.team_player_id) {
                                swapPositions(activeInning, dragPlayer, bp.team_player_id)
                              }
                              setDragPlayer(null)
                            }}
                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-move hover:shadow-md transition-all"
                          >
                            <div className="text-sm font-medium text-gray-600">{bp.name}</div>
                            {player?.player.jersey_number && (
                              <div className="text-xs text-gray-400">#{player.player.jersey_number}</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

              <p className="mt-4 text-xs text-gray-400">
                💡 Drag and drop players to swap positions within an inning
              </p>
            </div>
          </div>

          {/* Full Grid View */}
          <div className="bg-white rounded-lg shadow p-6 overflow-x-auto">
            <h4 className="text-md font-semibold text-gray-900 mb-3">Full Game Grid</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-700 sticky left-0 bg-white">#</th>
                  <th className="text-left py-2 pr-4 font-medium text-gray-700 sticky left-8 bg-white">Player</th>
                  {Array.from({ length: innings }, (_, i) => (
                    <th key={i} className="px-3 py-2 text-center font-medium text-gray-700">
                      Inn {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {generatedLineup.batting_order
                  .sort((a, b) => a.order - b.order)
                  .map((batter) => {
                    const player = players.find(p => p.id === batter.team_player_id)
                    return (
                      <tr key={batter.team_player_id} className="border-b border-gray-100">
                        <td className="py-2 pr-4 text-gray-500 font-mono text-xs sticky left-0 bg-white">
                          {batter.order}
                        </td>
                        <td className="py-2 pr-4 font-medium text-gray-900 sticky left-8 bg-white whitespace-nowrap">
                          {batter.name}
                          {player?.player.jersey_number && (
                            <span className="text-gray-400 ml-1 text-xs">#{player.player.jersey_number}</span>
                          )}
                        </td>
                        {Array.from({ length: innings }, (_, i) => {
                          const inning = (i + 1).toString()
                          const fieldAssignment = generatedLineup.field_assignments[inning]?.find(
                            a => a.team_player_id === batter.team_player_id
                          )
                          const isBenched = generatedLineup.bench_by_inning[inning]?.some(
                            b => b.team_player_id === batter.team_player_id
                          )
                          const pos = fieldAssignment?.position || (isBenched ? 'BENCH' : '?')
                          return (
                            <td key={i} className="px-1 py-2 text-center">
                              <span
                                className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getPositionStyle(pos)}`}
                              >
                                {pos}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Viewing a Saved Lineup */}
      {viewingLineup && !generatedLineup && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {viewingLineup.opponent ? `vs ${viewingLineup.opponent}` : 'Game Lineup'}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {formatDate(viewingLineup.game_date)} • {viewingLineup.innings} innings • {viewingLineup.pitching_type.replace('_', ' ')}
                </p>
                {viewingLineup.notes && (
                  <p className="text-sm text-gray-600 mt-2 italic">{viewingLineup.notes}</p>
                )}
              </div>
              <button
                onClick={() => { setViewingLineup(null); setViewingAssignments([]) }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Saved lineup grid */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="flex border-b border-gray-200">
              {Array.from({ length: viewingLineup.innings }, (_, i) => i + 1).map(inning => (
                <button
                  key={inning}
                  onClick={() => setActiveInning(inning)}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    activeInning === inning
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Inning {inning}
                </button>
              ))}
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {viewingAssignments
                  .filter(a => a.inning === activeInning && a.position !== 'BENCH')
                  .map((assignment) => (
                    <div
                      key={assignment.id}
                      className={`p-3 rounded-lg border-2 ${getPositionStyle(assignment.position)}`}
                    >
                      <div className="text-xs font-bold mb-1">{assignment.position}</div>
                      <div className="text-sm font-medium">{assignment.team_player?.player?.name}</div>
                      {assignment.team_player?.player?.jersey_number && (
                        <div className="text-xs opacity-70">#{assignment.team_player.player.jersey_number}</div>
                      )}
                    </div>
                  ))}
              </div>

              {/* Bench */}
              {viewingAssignments.filter(a => a.inning === activeInning && a.position === 'BENCH').length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-xs font-medium text-gray-500 mb-2">BENCH THIS INNING</div>
                  <div className="flex flex-wrap gap-2">
                    {viewingAssignments
                      .filter(a => a.inning === activeInning && a.position === 'BENCH')
                      .map((a) => (
                        <div key={a.id} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                          <div className="text-sm font-medium text-gray-600">{a.team_player?.player?.name}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Saved Lineups List */}
      {!generatedLineup && !viewingLineup && (
        <div>
          {savedLineups.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600 mb-2">No game lineups yet</p>
              <p className="text-sm text-gray-500 mb-4">
                Set position eligibility, then generate your first game day lineup
              </p>
              <button
                onClick={() => setShowSetup(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Your First Lineup
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Saved Lineups</h3>
              {savedLineups.map(lineup => (
                <div
                  key={lineup.id}
                  className="bg-white rounded-lg shadow p-4 flex justify-between items-center hover:shadow-md transition-shadow"
                >
                  <button
                    onClick={() => handleViewLineup(lineup)}
                    className="flex-1 text-left"
                  >
                    <div className="font-medium text-gray-900">
                      {lineup.opponent ? `vs ${lineup.opponent}` : 'Game Lineup'}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {formatDate(lineup.game_date)} • {lineup.innings} innings • {lineup.pitching_type.replace('_', ' ')}
                    </div>
                  </button>
                  <div className="flex items-center space-x-2 ml-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      lineup.status === 'final'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {lineup.status}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteLineup(lineup.id) }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
