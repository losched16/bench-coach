'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import SwingAnalysisUpload from '@/components/SwingAnalysisUpload'

export default function PlayerProfilePage({ params }: { params: { playerId: string } }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createClientComponentClient()

  const [player, setPlayer] = useState<any>(null)
  const [teamPlayer, setTeamPlayer] = useState<any>(null)
  const [notes, setNotes] = useState<any[]>([])
  const [newNote, setNewNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [showSwingUpload, setShowSwingUpload] = useState(false)

  useEffect(() => {
    if (teamId) {
      loadPlayerData()
    }
  }, [teamId, params.playerId])

  const loadPlayerData = async () => {
    try {
      // Load player basic info
      const { data: playerData } = await supabase
        .from('players')
        .select('*')
        .eq('id', params.playerId)
        .single()

      setPlayer(playerData)

      // Load team-specific data
      const { data: teamPlayerData } = await supabase
        .from('team_players')
        .select('*')
        .eq('player_id', params.playerId)
        .eq('team_id', teamId)
        .single()

      setTeamPlayer(teamPlayerData)

      // Load notes
      const { data: notesData } = await supabase
        .from('player_notes')
        .select('*')
        .eq('player_id', params.playerId)
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      setNotes(notesData || [])
    } catch (error) {
      console.error('Error loading player:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return

    try {
      const { error } = await supabase
        .from('player_notes')
        .insert({
          player_id: params.playerId,
          team_id: teamId,
          note: newNote
        })

      if (!error) {
        setNewNote('')
        loadPlayerData()
      }
    } catch (error) {
      console.error('Error adding note:', error)
    }
  }

  const updateRating = async (field: string, value: number) => {
    try {
      const { error } = await supabase
        .from('team_players')
        .update({ [field]: value })
        .eq('id', teamPlayer.id)

      if (!error) {
        setTeamPlayer({ ...teamPlayer, [field]: value })
      }
    } catch (error) {
      console.error('Error updating rating:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">Loading player...</div>
      </div>
    )
  }

  if (!player || !teamPlayer) {
    return (
      <div className="p-8">
        <div className="text-center text-gray-600">Player not found</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {player.name}
            {player.jersey_number && (
              <span className="text-gray-500 ml-2">#{player.jersey_number}</span>
            )}
          </h1>
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:underline mt-2"
          >
            ← Back to roster
          </button>
        </div>

        {/* Swing Analysis Button */}
        <button
          onClick={() => setShowSwingUpload(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center space-x-2"
        >
          <span>📹</span>
          <span>Analyze Swing</span>
        </button>
      </div>

      {/* Swing Upload Modal */}
      {showSwingUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Swing Analysis</h2>
              <button
                onClick={() => setShowSwingUpload(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <SwingAnalysisUpload
              playerId={params.playerId}
              playerName={player.name}
              teamId={teamId!}
              onSuccess={(analysisId) => {
                router.push(`/dashboard/swing-analysis/${analysisId}`)
              }}
            />
          </div>
        </div>
      )}

      {/* Player Info Card */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-semibold mb-4">Player Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Positions</p>
            <p className="font-medium">
              {teamPlayer.positions?.join(', ') || 'Not set'}
            </p>
          </div>
          {player.birth_year && (
            <div>
              <p className="text-sm text-gray-600">Age</p>
              <p className="font-medium">
                {new Date().getFullYear() - player.birth_year} years old
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Skill Ratings */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-semibold mb-4">Skill Ratings</h2>
        <div className="space-y-4">
          {/* Hitting */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Hitting</span>
              <span className="text-sm text-gray-600">{teamPlayer.hitting_level}/5</span>
            </div>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  onClick={() => updateRating('hitting_level', level)}
                  className={`w-12 h-12 rounded-lg border-2 ${
                    teamPlayer.hitting_level >= level
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-300 text-gray-400'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Throwing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Throwing</span>
              <span className="text-sm text-gray-600">{teamPlayer.throwing_level}/5</span>
            </div>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  onClick={() => updateRating('throwing_level', level)}
                  className={`w-12 h-12 rounded-lg border-2 ${
                    teamPlayer.throwing_level >= level
                      ? 'bg-green-600 border-green-600 text-white'
                      : 'border-gray-300 text-gray-400'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Fielding */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Fielding</span>
              <span className="text-sm text-gray-600">{teamPlayer.fielding_level}/5</span>
            </div>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  onClick={() => updateRating('fielding_level', level)}
                  className={`w-12 h-12 rounded-lg border-2 ${
                    teamPlayer.fielding_level >= level
                      ? 'bg-purple-600 border-purple-600 text-white'
                      : 'border-gray-300 text-gray-400'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Focus Notes */}
      {teamPlayer.focus_notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 mb-2">Focus Areas</h3>
          <p className="text-yellow-800">{teamPlayer.focus_notes}</p>
        </div>
      )}

      {/* Player Notes */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-semibold mb-4">Development Notes</h2>
        
        {/* Add Note */}
        <div className="mb-4">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note about this player's development..."
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
          />
          <button
            onClick={handleAddNote}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add Note
          </button>
        </div>

        {/* Notes List */}
        <div className="space-y-3">
          {notes.length === 0 ? (
            <p className="text-gray-500 text-sm">No notes yet</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="border-l-4 border-blue-500 pl-4 py-2">
                <p className="text-gray-700">{note.note}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(note.created_at).toLocaleDateString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
