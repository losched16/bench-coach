'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  Plus, Minus, ChevronDown, ChevronUp, X, Trophy, Clock,
  ThumbsUp, AlertTriangle, Target, Shield, Zap,
  MapPin, Send, Trash2, Activity, ChevronLeft, ChevronRight, Users, BookOpen
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { findExistingGame } from '@/lib/games'
import { LiveLineup } from '@/components/LiveLineup'
import { Scorebook } from '@/components/Scorebook'
import { usePageView } from '@/lib/tracking'

interface Player {
  id: string
  player_id: string
  player: { id: string; name: string; jersey_number?: string }
  positions: string[]
}

interface Game {
  id: string
  team_id: string
  game_date: string
  opponent: string
  location: string
  status: string
  team_score: number | null
  opponent_score: number | null
  result: string | null
  total_innings: number
  current_inning: number
  // The other half of the cursor. Without it "top of the third" and "bottom of
  // the third" were the same place, which is why changing pitchers meant
  // moving the inning.
  current_half: 'top' | 'bottom'
  is_home: boolean | null
  notes: string
  created_at: string
}

interface GameNote {
  id: string
  game_id: string
  player_id: string | null
  note: string
  note_type: string
  inning: number | null
  created_at: string
  player?: { name: string }
}

interface PitchCount {
  id: string
  game_id: string
  // Null for the other team's pitcher — nobody rosters them.
  player_id: string | null
  inning: number
  half: 'top' | 'bottom'
  is_opponent: boolean
  opponent_pitcher_name: string | null
  pitch_count: number
  player?: { name: string }
}

const NOTE_TYPES = [
  { key: 'positive', label: 'Good Play', icon: ThumbsUp, color: 'bg-green-500', bgLight: 'bg-green-50 border-green-200 text-green-800' },
  { key: 'concern', label: 'Concern', icon: AlertTriangle, color: 'bg-red-500', bgLight: 'bg-red-50 border-red-200 text-red-800' },
  { key: 'at_bat', label: 'At Bat', icon: Target, color: 'bg-blue-500', bgLight: 'bg-blue-50 border-blue-200 text-blue-800' },
  { key: 'fielding', label: 'Fielding', icon: Shield, color: 'bg-yellow-500', bgLight: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
  { key: 'pitching', label: 'Pitching', icon: Zap, color: 'bg-purple-500', bgLight: 'bg-purple-50 border-purple-200 text-purple-800' },
  { key: 'baserunning', label: 'Running', icon: MapPin, color: 'bg-orange-500', bgLight: 'bg-orange-50 border-orange-200 text-orange-800' },
  { key: 'general', label: 'General', icon: Activity, color: 'bg-gray-500', bgLight: 'bg-gray-50 border-gray-200 text-gray-800' },
]

function GamePageContent() {
  const [view, setView] = useState<'history' | 'setup' | 'live' | 'completed'>('history')
  const [games, setGames] = useState<Game[]>([])
  const [activeGame, setActiveGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [gameNotes, setGameNotes] = useState<GameNote[]>([])
  const [pitchCounts, setPitchCounts] = useState<PitchCount[]>([])
  const [loading, setLoading] = useState(true)

  // Setup form state
  const [setupOpponent, setSetupOpponent] = useState('')
  const [setupLocation, setSetupLocation] = useState('')
  const [setupDate, setSetupDate] = useState(new Date().toISOString().split('T')[0])
  const [setupInnings, setSetupInnings] = useState(6)
  // Which dugout. This decides which half we bat and which half we pitch, so
  // the pitch counter and the scorebook both need it before the first pitch.
  const [setupIsHome, setSetupIsHome] = useState(true)

  // Live game state
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [noteType, setNoteType] = useState<string | null>(null)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [pitchPanelOpen, setPitchPanelOpen] = useState(true)
  const [currentPitcher, setCurrentPitcher] = useState<string | null>(null)
  // Their arm, by name — nobody rosters the other team. Tracked in the same
  // panel with the same buttons, because it is the same act.
  const [opponentPitcher, setOpponentPitcher] = useState('')
  const [addingOpponentPitcher, setAddingOpponentPitcher] = useState(false)
  const [saving, setSaving] = useState(false)
  // Shown when a note or a pitch fails to land. Silence here cost real
  // observations — a coach types during an inning and does not go back to
  // check whether it stuck.
  const [actionError, setActionError] = useState<string | null>(null)
  const [showHandoff, setShowHandoff] = useState(false)
  const [lineupPanelOpen, setLineupPanelOpen] = useState(false)
  // The book. Closed by default — a coach who isn't scoring shouldn't have to
  // scroll past it, and one who is opens it once and leaves it open.
  const [scorebookOpen, setScorebookOpen] = useState(false)
  const router = useRouter()

  // End game state
  const [showEndModal, setShowEndModal] = useState(false)
  const [endScoreUs, setEndScoreUs] = useState('')
  const [endScoreThem, setEndScoreThem] = useState('')
  const [endNotes, setEndNotes] = useState('')

  // Viewing completed game
  const [viewingGame, setViewingGame] = useState<Game | null>(null)
  const [viewingNotes, setViewingNotes] = useState<GameNote[]>([])
  const [viewingPitchCounts, setViewingPitchCounts] = useState<PitchCount[]>([])

  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadData()
    }
  }, [teamId])

  const loadData = async () => {
    setLoading(true)
    try {
      const [gamesRes, playersRes] = await Promise.all([
        supabase.from('games').select('*').eq('team_id', teamId).order('game_date', { ascending: false }),
        supabase.from('team_players').select('id, player_id, player:players(id, name, jersey_number), positions').eq('team_id', teamId),
      ])

      if (gamesRes.data) {
        setGames(gamesRes.data)
        // Check for a live game
        const liveGame = gamesRes.data.find((g: Game) => g.status === 'live')
        if (liveGame) {
          setActiveGame(liveGame)
          setView('live')
          await loadGameData(liveGame.id)
        }
      }
      if (playersRes.data) setPlayers(playersRes.data as Player[])
    } catch (e) {
      console.error('Error loading game data:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadGameData = async (gameId: string) => {
    const [notesRes, pitchRes] = await Promise.all([
      supabase.from('game_notes').select('*, player:players(name)').eq('game_id', gameId).order('created_at', { ascending: false }),
      supabase.from('game_pitch_counts').select('*, player:players(name)').eq('game_id', gameId).order('inning'),
    ])
    if (notesRes.data) setGameNotes(notesRes.data)
    if (pitchRes.data) setPitchCounts(pitchRes.data)
  }

  const handleStartGame = async () => {
    if (!teamId || !setupOpponent.trim()) return
    setSaving(true)
    try {
      // If a lineup was built for this game, it already created the games row.
      // Start THAT one rather than a second record for the same event —
      // otherwise the lineup you made is attached to a game you aren't playing.
      const existing = await findExistingGame(supabase, {
        teamId, gameDate: setupDate, opponent: setupOpponent,
      })

      let data: any
      if (existing) {
        const { data: resumed, error } = await supabase
          .from('games')
          .update({
            location: setupLocation.trim() || null,
            total_innings: setupInnings,
            current_inning: 1,
            current_half: 'top',
            is_home: setupIsHome,
            status: 'live',
          })
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw error
        data = resumed
      } else {
        const { data: created, error } = await supabase.from('games').insert({
          team_id: teamId,
          game_date: setupDate,
          opponent: setupOpponent.trim(),
          location: setupLocation.trim() || null,
          total_innings: setupInnings,
          current_inning: 1,
          current_half: 'top',
          is_home: setupIsHome,
          status: 'live',
        }).select().single()
        if (error) throw error
        data = created
      }

      setActiveGame(data)
      setGameNotes([])
      setPitchCounts([])
      setView('live')
      setGames(prev => [data, ...prev.filter(g => g.id !== data.id)])
    } catch (e) {
      console.error('Error starting game:', e)
      alert('Failed to start game')
    } finally {
      setSaving(false)
    }
  }

  const handleAddNote = async () => {
    if (!activeGame || !noteInput.trim() || !noteType) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('game_notes').insert({
        game_id: activeGame.id,
        player_id: selectedPlayer || null,
        note: noteInput.trim(),
        note_type: noteType,
        inning: activeGame.current_inning,
      }).select('*, player:players(name)').single()

      if (error) throw error
      setGameNotes(prev => [data, ...prev])
      setNoteInput('')
      setShowNoteInput(false)
      setNoteType(null)
      // Haptic feedback on mobile
      if (navigator.vibrate) navigator.vibrate(50)
    } catch (e: any) {
      // This used to console.error and return, so a note that failed to save
      // looked exactly like a note that saved. The coach kept coaching and
      // lost the observation.
      console.error('Error adding note:', e)
      setActionError(e?.message || 'That note did not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    const { error } = await supabase.from('game_notes').delete().eq('id', noteId)
    if (!error) setGameNotes(prev => prev.filter(n => n.id !== noteId))
  }

  const handlePitchIncrement = async (delta: number) => {
    if (!activeGame) return
    const inning = activeGame.current_inning
    const half = activeGame.current_half

    // Whose arm this half belongs to. Ours only throws when we're in the
    // field, theirs only when we're at bat — so the same buttons serve both
    // and neither can land on the wrong pitcher.
    const ours = weArePitching
    const pitcherId = ours ? currentPitcher : null
    const oppName = ours ? null : (opponentPitcher.trim() || null)
    if (ours && !pitcherId) return
    if (!ours && !oppName) return

    const existing = pitchCounts.find(pc =>
      pc.inning === inning && pc.half === half &&
      (ours ? pc.player_id === pitcherId : pc.opponent_pitcher_name === oppName)
    )
    const newCount = Math.max(0, (existing?.pitch_count || 0) + delta)

    try {
      if (existing) {
        const { error } = await supabase.from('game_pitch_counts')
          .update({ pitch_count: newCount })
          .eq('id', existing.id)
        if (error) throw error
        setPitchCounts(prev => prev.map(pc => pc.id === existing.id ? { ...pc, pitch_count: newCount } : pc))
      } else {
        if (delta < 1) return
        const { data, error } = await supabase.from('game_pitch_counts').insert({
          game_id: activeGame.id,
          player_id: pitcherId,
          inning,
          half,
          is_opponent: !ours,
          opponent_pitcher_name: oppName,
          pitch_count: delta,
        }).select('*, player:players(name)').single()
        if (error) throw error
        if (data) setPitchCounts(prev => [...prev, data])
      }
      if (navigator.vibrate) navigator.vibrate(30)
    } catch (e: any) {
      console.error('Error updating pitch count:', e)
      setActionError(e?.message || 'That pitch did not save. Try again.')
    }
  }

  const handleInningChange = async (delta: number) => {
    if (!activeGame) return
    const newInning = Math.max(1, Math.min(activeGame.total_innings + 3, activeGame.current_inning + delta))
    const { error } = await supabase.from('games').update({ current_inning: newInning }).eq('id', activeGame.id)
    if (!error) setActiveGame(prev => prev ? { ...prev, current_inning: newInning } : null)
  }

  // Half the inning, which is the move a coach actually makes: we finish
  // batting, they come up, my pitcher goes back on. Top -> bottom stays in the
  // same inning; bottom -> top is the next one. This is the shared cursor —
  // the lineup panel and the scorebook both read it.
  const handleHalfChange = async (delta: number) => {
    if (!activeGame) return
    const forward = delta > 0
    let half: 'top' | 'bottom' = activeGame.current_half === 'top' ? 'bottom' : 'top'
    let inning = activeGame.current_inning
    if (forward && activeGame.current_half === 'bottom') inning = Math.min(activeGame.total_innings + 3, inning + 1)
    if (!forward && activeGame.current_half === 'top') inning = Math.max(1, inning - 1)

    const { error } = await supabase
      .from('games')
      .update({ current_inning: inning, current_half: half })
      .eq('id', activeGame.id)
    if (!error) {
      setActiveGame(prev => prev ? { ...prev, current_inning: inning, current_half: half } : null)
      // Whoever was throwing in the half we just left stays paused with their
      // count intact; the arm for the half we just entered comes back.
      setCurrentPitcher(null)
      setOpponentPitcher('')
    }
  }

  // Which side is on the mound right now. Away teams pitch in the bottom,
  // home teams in the top — the same fact the scorebook uses to decide who is
  // batting, so the two can never disagree about it.
  const weArePitching = activeGame
    ? (activeGame.is_home !== false ? activeGame.current_half === 'top' : activeGame.current_half === 'bottom')
    : true

  // Home or away. It decides which half we bat and which half we're in the
  // field, so the pitch counter and the scorebook both hang off it — which is
  // why it can't live only on the setup screen a coach passed twenty minutes
  // ago, or only inside a scorebook they may never open.
  const handleSetHome = async (v: boolean) => {
    if (!activeGame || activeGame.is_home === v) return
    setActiveGame(prev => prev ? { ...prev, is_home: v } : null)
    const { error } = await supabase.from('games').update({ is_home: v }).eq('id', activeGame.id)
    if (error) {
      setActiveGame(prev => prev ? { ...prev, is_home: !v } : null)
      setActionError(error.message || 'Could not change that.')
    }
  }

  // The book moved the inning or the half. Pull it back so the header, the
  // pitch panel and the lineup are all looking at the same place — that sync
  // is the whole point, and it must not require the coach to reload.
  const refreshCursor = async () => {
    if (!activeGame) return
    const { data } = await supabase
      .from('games')
      .select('current_inning, current_half, team_score, opponent_score')
      .eq('id', activeGame.id)
      .maybeSingle()
    const g = data as any
    if (!g) return
    setActiveGame(prev => prev ? { ...prev, ...g } : null)
    await loadGameData(activeGame.id)
  }

  const handleEndGame = async () => {
    if (!activeGame) return
    setSaving(true)
    try {
      const scoreUs = endScoreUs ? parseInt(endScoreUs) : null
      const scoreThem = endScoreThem ? parseInt(endScoreThem) : null
      let result: string | null = null
      if (scoreUs !== null && scoreThem !== null) {
        result = scoreUs > scoreThem ? 'win' : scoreUs < scoreThem ? 'loss' : 'tie'
      }
      const { error } = await supabase.from('games').update({
        status: 'completed',
        team_score: scoreUs,
        opponent_score: scoreThem,
        result,
        notes: endNotes.trim() || null,
      }).eq('id', activeGame.id)

      if (error) throw error
      const updatedGame = { ...activeGame, status: 'completed', team_score: scoreUs, opponent_score: scoreThem, result, notes: endNotes.trim() || null }
      setActiveGame(updatedGame)
      setGames(prev => prev.map(g => g.id === activeGame.id ? updatedGame as Game : g))
      setView('completed')
      setShowEndModal(false)
      // Every note taken during the game is already an observation the AI can
      // read — that happens on insert. What is missing after a game is the box
      // score, and this is the only moment the coach is holding their phone
      // thinking about the game.
      setShowHandoff(true)
    } catch (e) {
      console.error('Error ending game:', e)
      alert('Failed to end game')
    } finally {
      setSaving(false)
    }
  }

  const handleViewGame = async (game: Game) => {
    setViewingGame(game)
    const [notesRes, pitchRes] = await Promise.all([
      supabase.from('game_notes').select('*, player:players(name)').eq('game_id', game.id).order('created_at', { ascending: false }),
      supabase.from('game_pitch_counts').select('*, player:players(name)').eq('game_id', game.id).order('inning'),
    ])
    setViewingNotes(notesRes.data || [])
    setViewingPitchCounts(pitchRes.data || [])
  }

  const openNoteFlow = (type: string) => {
    setNoteType(type)
    setShowNoteInput(true)
    setTimeout(() => noteInputRef.current?.focus(), 100)
  }

  const getPlayerName = (playerId: string) => {
    const p = players.find(p => p.player.id === playerId)
    return p?.player.name || 'Unknown'
  }

  const getPlayerJersey = (playerId: string) => {
    const p = players.find(p => p.player.id === playerId)
    return p?.player.jersey_number
  }

  // Everyone who has thrown a pitch in this game, in the order they first
  // appeared. Per-inning rows are the storage; this is the roster of arms.
  const pitchersUsed = Array.from(
    new Set(
      [
        ...[...pitchCounts]
          .sort((a, b) => a.inning - b.inning)
          .filter(pc => pc.pitch_count > 0 && !pc.is_opponent && pc.player_id)
          .map(pc => pc.player_id as string),
        // Someone just brought in belongs on the strip before their first
        // pitch, or the panel shows no active arm at all.
        ...(currentPitcher ? [currentPitcher] : []),
      ]
    )
  )

  // Their arms, in the order they appeared. Same strip, so going back to a
  // pitcher who was pulled and returned is one tap on either side.
  const opponentPitchersUsed = Array.from(
    new Set(
      [
        ...[...pitchCounts]
          .sort((a, b) => a.inning - b.inning)
          .filter(pc => pc.pitch_count > 0 && pc.is_opponent && pc.opponent_pitcher_name)
          .map(pc => pc.opponent_pitcher_name as string),
        ...(opponentPitcher.trim() ? [opponentPitcher.trim()] : []),
      ]
    )
  )

  // Coming back to a half in progress, the arm on the mound is whoever threw
  // most recently IN THIS HALF. Making the coach re-pick them is a step for
  // nothing, and picking the wrong side would put pitches on the wrong kid.
  useEffect(() => {
    if (!activeGame || pitchCounts.length === 0) return
    const half = activeGame.current_half
    if (weArePitching) {
      if (currentPitcher) return
      const latest = [...pitchCounts]
        .filter(pc => pc.pitch_count > 0 && !pc.is_opponent && pc.player_id && pc.half === half)
        .sort((a, b) => b.inning - a.inning)[0]
      if (latest?.player_id) setCurrentPitcher(latest.player_id)
    } else {
      if (opponentPitcher) return
      const latest = [...pitchCounts]
        .filter(pc => pc.pitch_count > 0 && pc.is_opponent && pc.half === half)
        .sort((a, b) => b.inning - a.inning)[0]
      if (latest?.opponent_pitcher_name) setOpponentPitcher(latest.opponent_pitcher_name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchCounts, activeGame?.current_half, activeGame?.current_inning])

  // Totals are for the whole game and ignore the half — an arm's workload is
  // an arm's workload, and this is the number a pitch limit is measured
  // against.
  const getPitcherTotal = (playerId: string) => {
    return pitchCounts
      .filter(pc => !pc.is_opponent && pc.player_id === playerId)
      .reduce((sum, pc) => sum + pc.pitch_count, 0)
  }

  const getOpponentTotal = (name: string) => {
    return pitchCounts
      .filter(pc => pc.is_opponent && pc.opponent_pitcher_name === name)
      .reduce((sum, pc) => sum + pc.pitch_count, 0)
  }

  const getPitcherInningCount = (playerId: string, inning: number) => {
    return pitchCounts
      .filter(pc => !pc.is_opponent && pc.player_id === playerId && pc.inning === inning)
      .reduce((sum, pc) => sum + pc.pitch_count, 0)
  }

  const getOpponentInningCount = (name: string, inning: number) => {
    return pitchCounts
      .filter(pc => pc.is_opponent && pc.opponent_pitcher_name === name && pc.inning === inning)
      .reduce((sum, pc) => sum + pc.pitch_count, 0)
  }

  const getNoteTypeInfo = (type: string) => NOTE_TYPES.find(t => t.key === type) || NOTE_TYPES[6]

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading...</div>
  }

  // Viewing a completed game
  if (viewingGame) {
    return (
      <div className="max-w-2xl mx-auto p-4 pb-20">
        <button onClick={() => setViewingGame(null)} className="flex items-center gap-1 text-blue-600 mb-4 text-sm font-medium">
          <ChevronLeft size={16} /> Back to Games
        </button>

        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-gray-900">vs {viewingGame.opponent}</h2>
            {viewingGame.result && (
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                viewingGame.result === 'win' ? 'bg-green-100 text-green-700' :
                viewingGame.result === 'loss' ? 'bg-red-100 text-red-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {viewingGame.result.toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500">
            {formatDate(viewingGame.game_date)}
            {viewingGame.location && ` • ${viewingGame.location}`}
          </div>
          {viewingGame.team_score !== null && (
            <div className="mt-3 text-3xl font-bold text-gray-900">
              {viewingGame.team_score} - {viewingGame.opponent_score}
            </div>
          )}
          {viewingGame.notes && (
            <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{viewingGame.notes}</p>
          )}
        </div>

        {/* Pitch Count Summary */}
        {viewingPitchCounts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-3">Pitch Counts</h3>
            <div className="space-y-2">
              {Object.entries(
                viewingPitchCounts.reduce((acc: Record<string, { name: string, total: number, innings: Record<number, number> }>, pc) => {
                  const name = pc.player?.name || 'Unknown'
                  if (!acc[pc.player_id]) acc[pc.player_id] = { name, total: 0, innings: {} }
                  acc[pc.player_id].total += pc.pitch_count
                  acc[pc.player_id].innings[pc.inning] = pc.pitch_count
                  return acc
                }, {})
              ).map(([pid, data]) => (
                <div key={pid} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <div>
                    <span className="font-medium text-gray-900">{data.name}</span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {Object.entries(data.innings).map(([inn, count]) => `Inn ${inn}: ${count}`).join(' • ')}
                    </div>
                  </div>
                  <span className="text-xl font-bold text-purple-700">{data.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Game Notes */}
        {viewingNotes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-bold text-gray-900 mb-3">Game Notes ({viewingNotes.length})</h3>
            <div className="space-y-2">
              {viewingNotes.map(note => {
                const typeInfo = getNoteTypeInfo(note.note_type)
                return (
                  <div key={note.id} className={`p-3 rounded-lg border ${typeInfo.bgLight}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {note.inning && <span className="text-xs font-bold bg-white px-1.5 py-0.5 rounded border">Inn {note.inning}</span>}
                      {note.player && <span className="text-xs font-semibold">{note.player.name}</span>}
                      <span className="text-xs opacity-70">{typeInfo.label}</span>
                    </div>
                    <p className="text-sm">{note.note}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Game History (default view)
  if (view === 'history') {
    return (
      <div className="max-w-2xl mx-auto p-4 pb-20">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Game Day</h1>
          <button
            onClick={() => setView('setup')}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} /> Start Game
          </button>
        </div>

        {games.length === 0 ? (
          <div className="text-center py-16">
            <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">No games yet</h3>
            <p className="text-gray-400">Start your first game to begin tracking notes and pitch counts</p>
          </div>
        ) : (
          <div className="space-y-3">
            {games.map(game => (
              <button
                key={game.id}
                onClick={() => game.status === 'live' ? (() => { setActiveGame(game); setView('live'); loadGameData(game.id) })() : handleViewGame(game)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">vs {game.opponent}</span>
                      {game.status === 'live' && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full animate-pulse">LIVE</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {formatDate(game.game_date)}
                      {game.location && ` • ${game.location}`}
                    </div>
                  </div>
                  <div className="text-right">
                    {game.team_score !== null ? (
                      <div className="text-lg font-bold text-gray-900">{game.team_score}-{game.opponent_score}</div>
                    ) : game.status === 'live' ? (
                      <span className="text-sm text-red-600 font-medium">In Progress</span>
                    ) : null}
                    {game.result && (
                      <span className={`text-xs font-bold ${
                        game.result === 'win' ? 'text-green-600' : game.result === 'loss' ? 'text-red-600' : 'text-yellow-600'
                      }`}>
                        {game.result.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Setup form
  if (view === 'setup') {
    return (
      <div className="max-w-lg mx-auto p-4 pb-20">
        <button onClick={() => setView('history')} className="flex items-center gap-1 text-blue-600 mb-4 text-sm font-medium">
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Start New Game</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Opponent *</label>
            <input
              type="text"
              value={setupOpponent}
              onChange={e => setSetupOpponent(e.target.value)}
              placeholder="e.g., Blue Jays"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
            <input
              type="date"
              value={setupDate}
              onChange={e => setSetupDate(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Location</label>
            <input
              type="text"
              value={setupLocation}
              onChange={e => setSetupLocation(e.target.value)}
              placeholder="e.g., Field 3, Memorial Park"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Innings</label>
            <select
              value={setupInnings}
              onChange={e => setSetupInnings(parseInt(e.target.value))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {[3, 4, 5, 6, 7].map(n => (
                <option key={n} value={n}>{n} innings</option>
              ))}
            </select>
          </div>

          {/* Home bats last. It decides which half we're in the field, which
              is what tells the pitch counter whose arm is on. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Are we home or away?</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: 'Home', hint: 'we bat second' },
                { v: false, label: 'Away', hint: 'we bat first' },
              ].map(o => (
                <button
                  key={String(o.v)}
                  onClick={() => setSetupIsHome(o.v)}
                  className={`px-3 py-3 rounded-xl border text-left ${
                    setupIsHome === o.v
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                      : 'border-gray-300'
                  }`}
                >
                  <span className="block text-sm font-medium text-gray-900">{o.label}</span>
                  <span className="block text-xs text-gray-500">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStartGame}
            disabled={!setupOpponent.trim() || saving}
            className="w-full py-4 bg-green-600 text-white rounded-xl text-lg font-bold hover:bg-green-700 transition-colors disabled:opacity-50 mt-6"
          >
            {saving ? 'Starting...' : 'Start Game'}
          </button>
        </div>
      </div>
    )
  }

  // Completed game summary (after ending a live game)
  if (view === 'completed' && activeGame) {
    return (
      <div className="max-w-2xl mx-auto p-4 pb-20">
        <div className="text-center mb-6">
          <Trophy size={48} className={`mx-auto mb-3 ${
            activeGame.result === 'win' ? 'text-green-500' : activeGame.result === 'loss' ? 'text-red-400' : 'text-yellow-500'
          }`} />
          <h2 className="text-2xl font-bold text-gray-900">Game Complete</h2>
          <p className="text-gray-500">vs {activeGame.opponent} • {formatDate(activeGame.game_date)}</p>
          {activeGame.team_score !== null && (
            <div className="mt-2 text-4xl font-bold text-gray-900">{activeGame.team_score} - {activeGame.opponent_score}</div>
          )}
        </div>

        {/* Pitch Counts */}
        {pitchCounts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-3">Pitch Counts</h3>
            <div className="space-y-2">
              {Object.entries(
                pitchCounts.reduce((acc: Record<string, { name: string, total: number, innings: Record<number, number> }>, pc) => {
                  const name = pc.player?.name || getPlayerName(pc.player_id)
                  if (!acc[pc.player_id]) acc[pc.player_id] = { name, total: 0, innings: {} }
                  acc[pc.player_id].total += pc.pitch_count
                  acc[pc.player_id].innings[pc.inning] = pc.pitch_count
                  return acc
                }, {})
              ).map(([pid, data]) => (
                <div key={pid} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <div>
                    <span className="font-medium text-gray-900">{data.name}</span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {Object.entries(data.innings).map(([inn, count]) => `Inn ${inn}: ${count}`).join(' • ')}
                    </div>
                  </div>
                  <span className="text-xl font-bold text-purple-700">{data.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes Summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-bold text-gray-900 mb-3">Game Notes ({gameNotes.length})</h3>
          {gameNotes.length === 0 ? (
            <p className="text-sm text-gray-400">No notes recorded</p>
          ) : (
            <div className="space-y-2">
              {gameNotes.map(note => {
                const typeInfo = getNoteTypeInfo(note.note_type)
                return (
                  <div key={note.id} className={`p-3 rounded-lg border ${typeInfo.bgLight}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {note.inning && <span className="text-xs font-bold bg-white px-1.5 py-0.5 rounded border">Inn {note.inning}</span>}
                      {note.player && <span className="text-xs font-semibold">{note.player.name}</span>}
                      <span className="text-xs opacity-70">{typeInfo.label}</span>
                    </div>
                    <p className="text-sm">{note.note}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => { setView('history'); setActiveGame(null); loadData() }}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          Back to Games
        </button>
      </div>
    )
  }

  // LIVE GAME MODE
  if (view === 'live' && activeGame) {
    return (
      <div className="max-w-2xl mx-auto pb-24">
        {/* Game Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm opacity-80">vs {activeGame.opponent}</div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs bg-red-500 px-2 py-0.5 rounded-full font-bold animate-pulse">LIVE</span>
              </div>
            </div>
            {/* The cursor. One button moves the game on by a half-inning,
                which is the move a coach actually makes — we finish batting,
                they come up. Everything else on the screen follows it. */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleHalfChange(-1)}
                className="w-8 h-8 flex items-center justify-center bg-white/20 rounded-lg active:bg-white/30"
                aria-label="Back a half-inning"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="text-center min-w-[84px]">
                <div className="text-2xl font-bold leading-tight">
                  {activeGame.current_half === 'top' ? '▲' : '▼'} {activeGame.current_inning}
                </div>
                <div className="text-[10px] uppercase opacity-70">
                  {activeGame.current_half} {activeGame.current_inning} · {weArePitching ? 'field' : 'bat'}
                </div>
              </div>
              <button
                onClick={() => handleHalfChange(1)}
                className="w-8 h-8 flex items-center justify-center bg-white/20 rounded-lg active:bg-white/30"
                aria-label="On a half-inning"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Which dugout. One line, always visible, because everything below it
            depends on the answer — and a coach who has it backwards will see
            their pitcher's count going up while the other team is batting. */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            We&apos;re the{' '}
            <strong className="text-gray-900">
              {activeGame.is_home !== false ? 'home team' : 'away team'}
            </strong>
            {' — we bat '}{activeGame.is_home !== false ? 'second' : 'first'}
          </span>
          <div className="flex gap-1 shrink-0">
            {[
              { v: true, label: 'Home' },
              { v: false, label: 'Away' },
            ].map(o => (
              <button
                key={String(o.v)}
                onClick={() => handleSetHome(o.v)}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${
                  (activeGame.is_home !== false) === o.v
                    ? 'border-gray-800 bg-gray-800 text-white'
                    : 'border-gray-300 text-gray-600'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Player Selector Chips */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 overflow-x-auto sticky top-[68px] z-10">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setSelectedPlayer(null)}
              className={`px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                !selectedPlayer ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 active:bg-gray-200'
              }`}
            >
              Team
            </button>
            {players.map(p => (
              <button
                key={p.player.id}
                onClick={() => setSelectedPlayer(selectedPlayer === p.player.id ? null : p.player.id)}
                className={`px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedPlayer === p.player.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                }`}
              >
                {p.player.jersey_number ? `#${p.player.jersey_number} ` : ''}{p.player.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {NOTE_TYPES.map(type => {
              const Icon = type.icon
              return (
                <button
                  key={type.key}
                  onClick={() => openNoteFlow(type.key)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl active:scale-95 transition-transform ${type.color} text-white`}
                >
                  <Icon size={20} />
                  <span className="text-[10px] font-medium leading-tight">{type.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Note Input (slides open when action tapped) */}
        {showNoteInput && noteType && (
          <div className="bg-white border-b border-gray-200 px-4 py-3 animate-in slide-in-from-top">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${getNoteTypeInfo(noteType).color}`}>
                {getNoteTypeInfo(noteType).label}
              </span>
              {selectedPlayer && (
                <span className="text-sm font-medium text-gray-700">{getPlayerName(selectedPlayer)}</span>
              )}
              <button onClick={() => { setShowNoteInput(false); setNoteType(null) }} className="ml-auto p-1 text-gray-400">
                <X size={16} />
              </button>
            </div>
            <div className="flex gap-2">
              <textarea
                ref={noteInputRef}
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder="Add your observation..."
                rows={2}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteInput.trim() || saving}
                className="px-4 bg-blue-600 text-white rounded-xl font-medium active:bg-blue-700 disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Pitch Count Panel */}
        {/* The lineup, live. Sits above the pitch panel because a substitution
            is the decision a coach is most often mid-way through when they
            pick the phone up. */}
        <div className="bg-white border-b border-gray-200">
          <button
            onClick={() => setLineupPanelOpen(!lineupPanelOpen)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-blue-700"
          >
            <span className="flex items-center gap-2">
              <Users size={16} />
              Lineup &amp; subs
            </span>
            {lineupPanelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {lineupPanelOpen && activeGame && (
            <LiveLineup gameId={activeGame.id} inning={activeGame.current_inning} teamId={teamId} />
          )}
        </div>

        {/* The scorebook. Below the lineup because subs are the more frequent
            interruption, above pitch count because the book feeds it. */}
        <div className="bg-white border-b border-gray-200">
          <button
            onClick={() => setScorebookOpen(!scorebookOpen)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-gray-800"
          >
            <span className="flex items-center gap-2">
              <BookOpen size={16} />
              Scorebook
            </span>
            {scorebookOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {scorebookOpen && activeGame && (
            <Scorebook
              gameId={activeGame.id}
              currentPitcher={weArePitching ? currentPitcher : null}
              pitcherName={weArePitching && currentPitcher ? getPlayerName(currentPitcher) : null}
              onCursorChange={refreshCursor}
              isHome={activeGame.is_home !== false}
              onSetHome={handleSetHome}
            />
          )}
        </div>

        <div className="bg-white border-b border-gray-200">
          <button
            onClick={() => setPitchPanelOpen(!pitchPanelOpen)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-purple-700"
          >
            <span className="flex items-center gap-2">
              <Zap size={16} />
              Pitch Count
              {weArePitching
                ? currentPitcher && ` — ${getPlayerName(currentPitcher)}: ${getPitcherTotal(currentPitcher)}`
                : opponentPitcher && ` — ${opponentPitcher}: ${getOpponentTotal(opponentPitcher)}`}
            </span>
            {pitchPanelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {pitchPanelOpen && (
            <div className="px-4 pb-4">
              {/* Which side is throwing, and why. The half decides it, so the
                  coach never picks the wrong team's pitcher — moving the game
                  on by a half is what swaps the panel over, and the arm they
                  were counting stays exactly where it was. */}
              <div className={`mb-3 rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                weArePitching ? 'bg-purple-50 text-purple-900' : 'bg-gray-100 text-gray-700'
              }`}>
                <span>
                  <strong>{activeGame.current_half === 'top' ? 'Top' : 'Bottom'} {activeGame.current_inning}</strong>
                  {' — '}
                  {weArePitching ? 'our pitcher is on' : 'their pitcher is on'}
                </span>
                <button
                  onClick={() => handleHalfChange(1)}
                  className="shrink-0 px-2 py-1 rounded bg-white border border-gray-300 text-gray-700 font-medium"
                >
                  Next half →
                </button>
              </div>

              {weArePitching ? (
                <>
                  {/* Our arms. Someone pulled in the second and back in the
                      fifth keeps their total; tapping them resumes it. */}
                  {pitchersUsed.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
                      {pitchersUsed.map(pid => {
                        const isActive = pid === currentPitcher
                        const thisInning = getPitcherInningCount(pid, activeGame.current_inning)
                        return (
                          <button
                            key={pid}
                            onClick={() => setCurrentPitcher(pid)}
                            className={`shrink-0 px-3 py-2 rounded-lg border text-left transition-colors ${
                              isActive
                                ? 'bg-purple-700 text-white border-purple-700'
                                : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="text-xs font-medium truncate max-w-[8rem]">
                              {getPlayerName(pid)}
                            </div>
                            <div className="text-lg font-bold tabular-nums leading-tight">
                              {getPitcherTotal(pid)}
                              <span className={`text-xs font-normal ml-1 ${isActive ? 'text-purple-200' : 'text-gray-500'}`}>
                                {thisInning > 0 ? `+${thisInning} this inn` : 'resting'}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <select
                    value=""
                    onChange={e => { if (e.target.value) setCurrentPitcher(e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl mb-3 text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">
                      {pitchersUsed.length > 0 ? 'Bring in another pitcher…' : 'Who is pitching?'}
                    </option>
                    {players
                      .filter(p => !pitchersUsed.includes(p.player.id))
                      .map(p => (
                        <option key={p.player.id} value={p.player.id}>
                          {p.player.jersey_number ? `#${p.player.jersey_number} ` : ''}{p.player.name}
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                <>
                  {/* Theirs. Names, because nobody rosters the other team —
                      and the ones already seen are one tap away, so a coach
                      types a name once per game at most. */}
                  {opponentPitchersUsed.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
                      {opponentPitchersUsed.map(name => {
                        const isActive = name === opponentPitcher.trim()
                        const thisInning = getOpponentInningCount(name, activeGame.current_inning)
                        return (
                          <button
                            key={name}
                            onClick={() => { setOpponentPitcher(name); setAddingOpponentPitcher(false) }}
                            className={`shrink-0 px-3 py-2 rounded-lg border text-left transition-colors ${
                              isActive
                                ? 'bg-gray-800 text-white border-gray-800'
                                : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="text-xs font-medium truncate max-w-[8rem]">{name}</div>
                            <div className="text-lg font-bold tabular-nums leading-tight">
                              {getOpponentTotal(name)}
                              <span className={`text-xs font-normal ml-1 ${isActive ? 'text-gray-300' : 'text-gray-500'}`}>
                                {thisInning > 0 ? `+${thisInning} this inn` : 'resting'}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {addingOpponentPitcher || opponentPitchersUsed.length === 0 ? (
                    <input
                      value={opponentPitcher}
                      onChange={e => setOpponentPitcher(e.target.value)}
                      onBlur={() => setAddingOpponentPitcher(false)}
                      placeholder="Their pitcher — name or number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-xl mb-3 text-sm focus:ring-2 focus:ring-gray-400"
                    />
                  ) : (
                    <button
                      onClick={() => { setOpponentPitcher(''); setAddingOpponentPitcher(true) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-xl mb-3 text-sm text-left text-gray-600"
                    >
                      They brought someone else in…
                    </button>
                  )}
                </>
              )}

              {(weArePitching ? !!currentPitcher : !!opponentPitcher.trim()) && (
                <>
                  <div className="flex items-center justify-center gap-6 mb-4">
                    <button
                      onClick={() => handlePitchIncrement(-1)}
                      className="w-14 h-14 flex items-center justify-center bg-gray-200 rounded-full text-gray-700 active:bg-gray-300 text-xl font-bold"
                    >
                      -1
                    </button>
                    <div className="text-center">
                      <div className={`text-5xl font-bold ${weArePitching ? 'text-purple-700' : 'text-gray-800'}`}>
                        {weArePitching
                          ? getPitcherInningCount(currentPitcher!, activeGame.current_inning)
                          : getOpponentInningCount(opponentPitcher.trim(), activeGame.current_inning)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">This Inning</div>
                    </div>
                    <button
                      onClick={() => handlePitchIncrement(1)}
                      className={`w-14 h-14 flex items-center justify-center rounded-full text-white text-xl font-bold shadow-lg ${
                        weArePitching ? 'bg-purple-600 active:bg-purple-700' : 'bg-gray-700 active:bg-gray-800'
                      }`}
                    >
                      +1
                    </button>
                  </div>

                  <div className="text-center mb-3">
                    <span className="text-sm text-gray-500">Game Total: </span>
                    <span className={`text-lg font-bold ${weArePitching ? 'text-purple-700' : 'text-gray-800'}`}>
                      {weArePitching
                        ? getPitcherTotal(currentPitcher!)
                        : getOpponentTotal(opponentPitcher.trim())} pitches
                    </span>
                  </div>

                  {/* Per-Inning Breakdown */}
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {Array.from({ length: activeGame.current_inning }, (_, i) => i + 1).map(inn => {
                      const count = weArePitching
                        ? getPitcherInningCount(currentPitcher!, inn)
                        : getOpponentInningCount(opponentPitcher.trim(), inn)
                      if (count === 0 && inn !== activeGame.current_inning) return null
                      return (
                        <div key={inn} className={`flex-shrink-0 text-center px-3 py-1.5 rounded-lg border ${
                          inn === activeGame.current_inning ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'
                        }`}>
                          <div className="text-[10px] text-gray-500">Inn {inn}</div>
                          <div className="text-sm font-bold">{count}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Timeline Feed */}
        <div className="px-4 py-3">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            Game Notes {gameNotes.length > 0 && `(${gameNotes.length})`}
          </h3>
          {gameNotes.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              Tap an action button above to start recording
            </div>
          ) : (
            <div className="space-y-2">
              {gameNotes.map(note => {
                const typeInfo = getNoteTypeInfo(note.note_type)
                return (
                  <div key={note.id} className={`p-3 rounded-xl border ${typeInfo.bgLight} relative group`}>
                    <div className="flex items-center gap-2 mb-1">
                      {note.inning && (
                        <span className="text-[10px] font-bold bg-white px-1.5 py-0.5 rounded border border-gray-200">
                          Inn {note.inning}
                        </span>
                      )}
                      {note.player && (
                        <span className="text-xs font-semibold">{note.player.name}</span>
                      )}
                      <span className="text-[10px] opacity-60">{typeInfo.label}</span>
                      <span className="text-[10px] opacity-40 ml-auto">
                        {new Date(note.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed">{note.note}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {actionError && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 max-w-sm w-[92%] bg-red-600 text-white text-sm rounded-lg px-4 py-3 shadow-lg flex items-start gap-2">
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError(null)} className="shrink-0 opacity-80 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {/* Sticky Footer - End Game */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30">
          <button
            onClick={async () => {
              // If the book was kept, it already knows the score. Asking a
              // coach to retype what they just spent six innings recording is
              // how a feature gets called pointless. Read it fresh — the
              // scorebook writes the score server-side as runs come in.
              if (activeGame) {
                const { data } = await supabase
                  .from('games')
                  .select('team_score, opponent_score')
                  .eq('id', activeGame.id)
                  .maybeSingle()
                const g = data as any
                if (g?.team_score != null) setEndScoreUs(String(g.team_score))
                if (g?.opponent_score != null) setEndScoreThem(String(g.opponent_score))
              }
              setShowEndModal(true)
            }}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-bold active:bg-red-700 transition-colors"
          >
            End Game
          </button>
        </div>

        {/* End Game Modal */}
        {/* After the final out. The notes are already saved and already
            visible to the AI; the box score is the only thing that isn't, and
            this is the one moment the coach is thinking about this game. */}
        {showHandoff && activeGame && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Game saved</h3>
              <p className="text-sm text-gray-600 mb-4">
                {gameNotes.length > 0
                  ? `Your ${gameNotes.length} note${gameNotes.length === 1 ? '' : 's'} from this game ${
                      gameNotes.length === 1 ? 'is' : 'are'
                    } already in — they'll show up in the next read on these players.`
                  : 'No notes were taken during this one, so there is nothing from the game itself to go on yet.'}
              </p>

              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="text-sm text-gray-800 font-medium mb-1">Add the box score?</p>
                <p className="text-xs text-gray-600">
                  A screenshot from GameChanger takes about ten seconds and gives every read after
                  this one real numbers to work from instead of impressions.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    const params = new URLSearchParams({ teamId: teamId || '' })
                    params.set('type', 'game')
                    if (activeGame.game_date) params.set('date', String(activeGame.game_date).slice(0, 10))
                    if (activeGame.opponent) params.set('opponent', activeGame.opponent)
                    router.push(`/dashboard/log?${params}`)
                  }}
                  className="w-full py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                >
                  Add the box score
                </button>
                <button
                  onClick={() => setShowHandoff(false)}
                  className="w-full py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        {showEndModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">End Game</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Score</label>
                  <input
                    type="number"
                    value={endScoreUs}
                    onChange={e => setEndScoreUs(e.target.value)}
                    placeholder="0"
                    min="0"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-2xl text-center font-bold focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{activeGame.opponent}</label>
                  <input
                    type="number"
                    value={endScoreThem}
                    onChange={e => setEndScoreThem(e.target.value)}
                    placeholder="0"
                    min="0"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-2xl text-center font-bold focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Final Notes</label>
                <textarea
                  value={endNotes}
                  onChange={e => setEndNotes(e.target.value)}
                  placeholder="Overall thoughts on the game..."
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEndModal(false)}
                  className="flex-1 py-3 border border-gray-300 rounded-xl font-medium text-gray-700 active:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEndGame}
                  disabled={saving}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold active:bg-red-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save & Complete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}

export default function GamePage() {
  usePageView('game')
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-500">Loading...</div>}>
      <GamePageContent />
    </Suspense>
  )
}
