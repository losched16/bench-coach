'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, User, Trash2, ChevronRight, StickyNote, Upload, Camera, Check, X, Loader2 } from 'lucide-react'
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

interface ImportedPlayer {
  name: string
  jersey_number: string | null
  positions: string[]
  selected: boolean
}

function RosterPageContent() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [playerToDelete, setPlayerToDelete] = useState<Player | null>(null)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [newPlayerJersey, setNewPlayerJersey] = useState('')
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()
  
  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importImage, setImportImage] = useState<string | null>(null)
  const [importMimeType, setImportMimeType] = useState<string>('image/png')
  const [analyzing, setAnalyzing] = useState(false)
  const [importedPlayers, setImportedPlayers] = useState<ImportedPlayer[]>([])
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'importing'>('upload')
  const [importProgress, setImportProgress] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)

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
      await supabase
        .from('team_players')
        .delete()
        .eq('id', playerToDelete.id)

      const { data: otherTeams } = await supabase
        .from('team_players')
        .select('id')
        .eq('player_id', playerToDelete.player.id)

      if (!otherTeams || otherTeams.length === 0) {
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

  // Import functions
  const resetImport = () => {
    setImportImage(null)
    setImportedPlayers([])
    setImportStep('upload')
    setImportProgress(0)
    setImportError(null)
    setAnalyzing(false)
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Convert to base64
    const reader = new FileReader()
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1]
      setImportImage(base64)
      setImportMimeType(file.type)
      setImportError(null)
      
      // Analyze the image
      setAnalyzing(true)
      try {
        const response = await fetch('/api/roster/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mimeType: file.type }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to analyze image')
        }

        if (data.players && data.players.length > 0) {
          setImportedPlayers(data.players.map((p: any) => ({ ...p, selected: true })))
          setImportStep('preview')
        } else {
          setImportError('No players found in the image. Please try a clearer screenshot of your roster.')
        }
      } catch (error: any) {
        console.error('Import error:', error)
        setImportError(error.message || 'Failed to analyze image')
      } finally {
        setAnalyzing(false)
      }
    }
    reader.readAsDataURL(file)
    
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const togglePlayerSelection = (index: number) => {
    setImportedPlayers(prev => prev.map((p, i) => 
      i === index ? { ...p, selected: !p.selected } : p
    ))
  }

  const toggleAllPlayers = (selected: boolean) => {
    setImportedPlayers(prev => prev.map(p => ({ ...p, selected })))
  }

  const updateImportedPlayer = (index: number, field: keyof ImportedPlayer, value: any) => {
    setImportedPlayers(prev => prev.map((p, i) => 
      i === index ? { ...p, [field]: value } : p
    ))
  }

  const handleImportPlayers = async () => {
    if (!teamId) return

    const selectedPlayers = importedPlayers.filter(p => p.selected)
    if (selectedPlayers.length === 0) return

    setImportStep('importing')
    setImportProgress(0)

    try {
      const { data: team } = await supabase
        .from('teams')
        .select('coach_id')
        .eq('id', teamId)
        .single()

      for (let i = 0; i < selectedPlayers.length; i++) {
        const p = selectedPlayers[i]
        
        // Create player
        const { data: player } = await supabase
          .from('players')
          .insert({
            coach_id: team.coach_id,
            name: p.name,
            jersey_number: p.jersey_number || null,
          })
          .select()
          .single()

        // Link to team with positions
        await supabase
          .from('team_players')
          .insert({
            team_id: teamId,
            player_id: player.id,
            positions: p.positions || [],
          })

        setImportProgress(Math.round(((i + 1) / selectedPlayers.length) * 100))
      }

      // Success - close modal and refresh
      setShowImportModal(false)
      resetImport()
      loadRoster()
    } catch (error) {
      console.error('Error importing players:', error)
      setImportError('Failed to import some players. Please try again.')
      setImportStep('preview')
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading roster...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Roster</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Camera size={20} />
            <span>Import from Screenshot</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            <span>Add Player</span>
          </button>
        </div>
      </div>

      {players.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <User className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600 mb-4">No players yet</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Camera size={18} />
              <span>Import from Screenshot</span>
            </button>
            <span className="text-gray-400">or</span>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Manually
            </button>
          </div>
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

      {/* Import Roster Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Import Roster from Screenshot</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Upload a screenshot from SportsEngine, GameChanger, or any roster app
                </p>
              </div>
              <button 
                onClick={() => { setShowImportModal(false); resetImport() }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {/* Upload Step */}
              {importStep === 'upload' && (
                <div className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  
                  {analyzing ? (
                    <div className="text-center py-12">
                      <Loader2 className="mx-auto animate-spin text-blue-600 mb-4" size={48} />
                      <p className="text-gray-600">Analyzing roster...</p>
                      <p className="text-sm text-gray-400 mt-1">This may take a few seconds</p>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-12 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                      >
                        <Upload className="mx-auto text-gray-400 mb-3" size={48} />
                        <p className="text-gray-600 font-medium">Click to upload screenshot</p>
                        <p className="text-sm text-gray-400 mt-1">or drag and drop</p>
                      </button>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="font-medium text-blue-900 mb-2">How it works:</h4>
                        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                          <li>Open your roster in SportsEngine, GameChanger, etc.</li>
                          <li>Take a screenshot showing player names</li>
                          <li>Upload the screenshot here</li>
                          <li>Review and import the players</li>
                        </ol>
                      </div>
                    </>
                  )}

                  {importError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                      {importError}
                    </div>
                  )}
                </div>
              )}

              {/* Preview Step */}
              {importStep === 'preview' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-600">
                      Found <strong>{importedPlayers.length}</strong> players. Select which ones to import:
                    </p>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => toggleAllPlayers(true)}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        Select all
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => toggleAllPlayers(false)}
                        className="text-sm text-gray-600 hover:text-gray-700"
                      >
                        Deselect all
                      </button>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-80 overflow-y-auto">
                    {importedPlayers.map((player, index) => (
                      <div 
                        key={index} 
                        className={`p-3 flex items-center space-x-3 ${player.selected ? 'bg-white' : 'bg-gray-50'}`}
                      >
                        <button
                          onClick={() => togglePlayerSelection(index)}
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                            player.selected 
                              ? 'bg-blue-600 border-blue-600 text-white' 
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          {player.selected && <Check size={14} />}
                        </button>
                        
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={player.name}
                            onChange={(e) => updateImportedPlayer(index, 'name', e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                            placeholder="Name"
                          />
                          <input
                            type="text"
                            value={player.jersey_number || ''}
                            onChange={(e) => updateImportedPlayer(index, 'jersey_number', e.target.value || null)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                            placeholder="Jersey #"
                          />
                          <input
                            type="text"
                            value={player.positions?.join(', ') || ''}
                            onChange={(e) => updateImportedPlayer(index, 'positions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                            placeholder="Positions (SS, 2B)"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {importError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                      {importError}
                    </div>
                  )}

                  <div className="flex space-x-3">
                    <button
                      onClick={resetImport}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Start Over
                    </button>
                    <button
                      onClick={handleImportPlayers}
                      disabled={importedPlayers.filter(p => p.selected).length === 0}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Import {importedPlayers.filter(p => p.selected).length} Players
                    </button>
                  </div>
                </div>
              )}

              {/* Importing Step */}
              {importStep === 'importing' && (
                <div className="text-center py-12">
                  <Loader2 className="mx-auto animate-spin text-blue-600 mb-4" size={48} />
                  <p className="text-gray-600 mb-2">Importing players...</p>
                  <div className="w-full max-w-xs mx-auto bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-400 mt-2">{importProgress}%</p>
                </div>
              )}
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
