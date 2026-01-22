'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Plus, User, Trash2 } from 'lucide-react'

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

export default function RosterPage() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [deletePlayerId, setDeletePlayerId] = useState<string | null>(null)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [newPlayerJersey, setNewPlayerJersey] = useState('')
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createClientComponentClient()

  useEffect(() => {
    if (teamId) {
      loadRoster()
    }
  }, [teamId])

  const loadRoster = async () => {
    try {
      const { data } = await supabase
        .from('team_players')
        .select(`
          *,
          player:players(*)
        `)
        .eq('team_id', teamId)
        .order('player(name)')

      if (data) {
        setPlayers(data as any)
      }
    } catch (error) {
      console.error('Error loading roster:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim() || !teamId) return

    try {
      const { data: team } = await supabase
        .from('teams')
        .select('coach_id')
        .eq('id', teamId)
        .single()

      const { data: player } = await supabase
        .from('players')
        .insert({
          coach_id: team.coach_id,
          name: newPlayerName,
          jersey_number: newPlayerJersey || null,
        })
        .select()
        .single()

      await supabase
        .from('team_players')
        .insert({
          team_id: teamId,
          player_id: player.id,
        })

      setNewPlayerName('')
      setNewPlayerJersey('')
      setShowAddModal(false)
      loadRoster()
    } catch (error) {
      console.error('Error adding player:', error)
      alert('Failed to add player')
    }
  }

  const handleDeletePlayer = async () => {
    if (!deletePlayerId) return

    try {
      // Delete team_player relationship
      await supabase
        .from('team_players')
        .delete()
        .eq('id', deletePlayerId)

      setDeletePlayerId(null)
      loadRoster()
    } catch (error) {
      console.error('Error deleting player:', error)
      alert('Failed to delete player')
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading roster...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Roster</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          <span>Add Player</span>
        </button>
      </div>

      {players.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <User className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600 mb-4">No players yet</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Your First Player
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            <div key={player.id} className="bg-white rounded-lg shadow p-6 relative">
              <button
                onClick={() => setDeletePlayerId(player.id)}
                className="absolute top-4 right-4 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Remove player"
              >
                <Trash2 size={18} />
              </button>

              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {player.player.name}
                </h3>
                {player.player.jersey_number && (
                  <span className="text-sm text-gray-600">#{player.player.jersey_number}</span>
                )}
              </div>

              {player.positions && player.positions.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-gray-500 mb-1">Positions</div>
                  <div className="flex flex-wrap gap-1">
                    {player.positions.map((pos) => (
                      <span key={pos} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                        {pos}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 text-sm">
                {player.hitting_level && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Hitting:</span>
                    <span className="font-medium">{player.hitting_level}/5</span>
                  </div>
                )}
                {player.throwing_level && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Throwing:</span>
                    <span className="font-medium">{player.throwing_level}/5</span>
                  </div>
                )}
                {player.fielding_level && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Fielding:</span>
                    <span className="font-medium">{player.fielding_level}/5</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Player Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Add Player</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Player Name *
                </label>
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Tommy Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Jersey Number (optional)
                </label>
                <input
                  type="text"
                  value={newPlayerJersey}
                  onChange={(e) => setNewPlayerJersey(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., 12"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddPlayer}
                  disabled={!newPlayerName.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Player
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletePlayerId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Remove Player?</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to remove this player from the roster? Their notes will be kept.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setDeletePlayerId(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePlayer}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}