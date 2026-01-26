'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, User, Trash2, ChevronRight, StickyNote } from 'lucide-react'
import Link from 'next/link'

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
  notes_count?: number
}

function RosterPageContent() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [playerToDelete, setPlayerToDelete] = useState<Player | null>(null)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [newPlayerJersey, setNewPlayerJersey] = useState('')
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

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
        // Fetch note counts for each player
        const playersWithNotes = await Promise.all(
          data.map(async (p: any) => {
            const { count } = await supabase
              .from('player_notes')
              .select('*', { count: 'exact', head: true })
              .eq('player_id', p.player.id)
              .eq('team_id', teamId)
            
            return { ...p, notes_count: count || 0 }
          })
        )
        setPlayers(playersWithNotes as any)
      }
    } catch (error) {
      console.error('Error loading roster:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePlayer = async () => {
    if (!playerToDelete) return

    try {
      // Delete from team_players (removes from this team's roster)
      await supabase
        .from('team_players')
        .delete()
        .eq('id', playerToDelete.id)

      // Optionally delete the player entirely if they're not on any other teams
      const { data: otherTeams } = await supabase
        .from('team_players')
        .select('id')
        .eq('player_id', playerToDelete.player.id)

      if (!otherTeams || otherTeams.length === 0) {
        // Player is not on any other teams, safe to delete entirely
        await supabase
          .from('players')
          .delete()
          .eq('id', playerToDelete.player.id)
      }

      setShowDeleteModal(false)
      setPlayerToDelete(null)
      loadRoster()
    } catch (error) {
      console.error('Error deleting player:', error)
      alert('Failed to delete player')
    }
  }

  const confirmDeletePlayer = (player: Player) => {
    setPlayerToDelete(player)
    setShowDeleteModal(true)
  }

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim() || !teamId) return

    try {
      // Get coach ID
      const { data: team } = await supabase
        .from('teams')
        .select('coach_id')
        .eq('id', teamId)
        .single()

      // Create player
      const { data: player } = await supabase
        .from('players')
        .insert({
          coach_id: team.coach_id,
          name: newPlayerName,
          jersey_number: newPlayerJersey || null,
        })
        .select()
        .single()

      // Link to team
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
            <div key={player.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
              <Link 
                href={`/dashboard/roster/${player.player.id}?teamId=${teamId}`}
                className="block p-6"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <User className="text-gray-500" size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {player.player.name}
                      </h3>
                      {player.player.jersey_number && (
                        <span className="text-sm text-gray-600">#{player.player.jersey_number}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="text-gray-400" size={20} />
                </div>

                {player.positions && player.positions.length > 0 && (
                  <div className="mb-3">
                    <div className="flex flex-wrap gap-1">
                      {player.positions.map((pos) => (
                        <span key={pos} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                          {pos}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-4 text-gray-500">
                    {player.hitting_level && (
                      <span>Hit: {player.hitting_level}/5</span>
                    )}
                    {player.throwing_level && (
                      <span>Throw: {player.throwing_level}/5</span>
                    )}
                  </div>
                  {player.notes_count !== undefined && player.notes_count > 0 && (
                    <div className="flex items-center space-x-1 text-yellow-600">
                      <StickyNote size={14} />
                      <span className="text-xs">{player.notes_count}</span>
                    </div>
                  )}
                </div>
              </Link>
              
              {/* Delete button outside the link */}
              <div className="px-6 pb-4 pt-0 flex justify-end border-t border-gray-100">
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    confirmDeletePlayer(player)
                  }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors text-sm flex items-center space-x-1"
                  title="Remove player"
                >
                  <Trash2 size={16} />
                  <span>Remove</span>
                </button>
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

      {/* Delete Player Confirmation Modal */}
      {showDeleteModal && playerToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Remove Player</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to remove <strong>{playerToDelete.player.name}</strong> from this roster?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  setPlayerToDelete(null)
                }}
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

export default function RosterPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <RosterPageContent />
    </Suspense>
  )
}