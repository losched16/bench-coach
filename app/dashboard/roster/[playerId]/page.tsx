'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { 
  ArrowLeft, User, Plus, Trash2, Pencil, StickyNote, 
  Target, TrendingUp, Award, Calendar
} from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface PlayerData {
  id: string
  name: string
  jersey_number: string | null
  team_player: {
    id: string
    positions: string[]
    hitting_level: number | null
    throwing_level: number | null
    fielding_level: number | null
  }
}

interface PlayerNote {
  id: string
  note: string
  created_at: string
}

interface ActivePlaybook {
  id: string
  title: string
  status: string
  completed_sessions: any[]
  template: {
    title: string
    total_sessions: number
    skill_category: string
  }
}

function PlayerDetailContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const playerId = params.playerId as string
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  const [player, setPlayer] = useState<PlayerData | null>(null)
  const [notes, setNotes] = useState<PlayerNote[]>([])
  const [playbooks, setPlaybooks] = useState<ActivePlaybook[]>([])
  const [loading, setLoading] = useState(true)
  
  // Modal states
  const [showAddNoteModal, setShowAddNoteModal] = useState(false)
  const [showEditNoteModal, setShowEditNoteModal] = useState(false)
  const [showDeleteNoteModal, setShowDeleteNoteModal] = useState(false)
  const [noteToEdit, setNoteToEdit] = useState<PlayerNote | null>(null)
  const [noteToDelete, setNoteToDelete] = useState<PlayerNote | null>(null)
  const [newNote, setNewNote] = useState('')
  const [editNote, setEditNote] = useState('')

  useEffect(() => {
    if (playerId && teamId) {
      loadPlayerData()
    }
  }, [playerId, teamId])

  const loadPlayerData = async () => {
    setLoading(true)
    try {
      // Load player info with team_player data
      const { data: playerData } = await supabase
        .from('players')
        .select(`
          id,
          name,
          jersey_number
        `)
        .eq('id', playerId)
        .single()

      // Load team_player data separately
      const { data: teamPlayerData } = await supabase
        .from('team_players')
        .select('id, positions, hitting_level, throwing_level, fielding_level')
        .eq('player_id', playerId)
        .eq('team_id', teamId)
        .single()

      if (playerData && teamPlayerData) {
        setPlayer({
          ...playerData,
          team_player: teamPlayerData
        })
      }

      // Load player notes
      const { data: notesData } = await supabase
        .from('player_notes')
        .select('*')
        .eq('player_id', playerId)
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      setNotes(notesData || [])

      // Load active playbooks for this player
      const { data: playbooksData } = await supabase
        .from('player_playbooks')
        .select(`
          id,
          title,
          status,
          completed_sessions,
          template:playbook_templates(title, total_sessions, skill_category)
        `)
        .eq('player_id', playerId)
        .eq('team_id', teamId)

      setPlaybooks(playbooksData || [])

    } catch (error) {
      console.error('Error loading player data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim() || !teamId || !playerId) return

    try {
      await supabase
        .from('player_notes')
        .insert({
          team_id: teamId,
          player_id: playerId,
          note: newNote.trim(),
        })

      setNewNote('')
      setShowAddNoteModal(false)
      loadPlayerData()
    } catch (error) {
      console.error('Error adding note:', error)
      alert('Failed to add note')
    }
  }

  const openEditNoteModal = (note: PlayerNote) => {
    setNoteToEdit(note)
    setEditNote(note.note)
    setShowEditNoteModal(true)
  }

  const handleEditNote = async () => {
    if (!editNote.trim() || !noteToEdit) return

    try {
      await supabase
        .from('player_notes')
        .update({ note: editNote.trim() })
        .eq('id', noteToEdit.id)

      setShowEditNoteModal(false)
      setNoteToEdit(null)
      setEditNote('')
      loadPlayerData()
    } catch (error) {
      console.error('Error updating note:', error)
      alert('Failed to update note')
    }
  }

  const confirmDeleteNote = (note: PlayerNote) => {
    setNoteToDelete(note)
    setShowDeleteNoteModal(true)
  }

  const handleDeleteNote = async () => {
    if (!noteToDelete) return

    try {
      await supabase
        .from('player_notes')
        .delete()
        .eq('id', noteToDelete.id)

      setShowDeleteNoteModal(false)
      setNoteToDelete(null)
      loadPlayerData()
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Failed to delete note')
    }
  }

  const getSkillLevelLabel = (level: number | null) => {
    if (!level) return 'Not rated'
    const labels = ['', 'Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert']
    return labels[level] || 'Not rated'
  }

  const getSkillLevelColor = (level: number | null) => {
    if (!level) return 'bg-gray-100 text-gray-600'
    const colors = [
      '',
      'bg-red-100 text-red-700',
      'bg-orange-100 text-orange-700',
      'bg-yellow-100 text-yellow-700',
      'bg-green-100 text-green-700',
      'bg-blue-100 text-blue-700',
    ]
    return colors[level] || 'bg-gray-100 text-gray-600'
  }

  if (loading) {
    return <div className="text-gray-600">Loading player...</div>
  }

  if (!player) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">Player not found</p>
        <button
          onClick={() => router.push(`/dashboard/roster?teamId=${teamId}`)}
          className="text-red-600 hover:text-red-700"
        >
          Back to Roster
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => router.push(`/dashboard/roster?teamId=${teamId}`)}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-3">
            <span>{player.name}</span>
            {player.jersey_number && (
              <span className="text-lg font-normal text-gray-500">#{player.jersey_number}</span>
            )}
          </h2>
          <p className="text-gray-600">Player Profile</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Player Info */}
        <div className="space-y-6">
          {/* Basic Info Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center space-x-4 mb-6">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center">
                <User className="text-gray-500" size={32} />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{player.name}</h3>
                {player.jersey_number && (
                  <p className="text-gray-600">Jersey #{player.jersey_number}</p>
                )}
              </div>
            </div>

            {/* Positions */}
            {player.team_player.positions && player.team_player.positions.length > 0 && (
              <div className="mb-4">
                <div className="text-sm text-gray-500 mb-2">Positions</div>
                <div className="flex flex-wrap gap-2">
                  {player.team_player.positions.map((pos) => (
                    <span key={pos} className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium">
                      {pos}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Skills Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center space-x-2">
              <Target size={18} className="text-gray-500" />
              <span>Skill Levels</span>
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Hitting</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getSkillLevelColor(player.team_player.hitting_level)}`}>
                  {getSkillLevelLabel(player.team_player.hitting_level)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Throwing</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getSkillLevelColor(player.team_player.throwing_level)}`}>
                  {getSkillLevelLabel(player.team_player.throwing_level)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Fielding</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getSkillLevelColor(player.team_player.fielding_level)}`}>
                  {getSkillLevelLabel(player.team_player.fielding_level)}
                </span>
              </div>
            </div>
          </div>

          {/* Active Playbooks */}
          {playbooks.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h4 className="font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                <TrendingUp size={18} className="text-green-600" />
                <span>Active Playbooks</span>
              </h4>
              <div className="space-y-3">
                {playbooks.map((pb) => {
                  const completed = Array.isArray(pb.completed_sessions) ? pb.completed_sessions.length : 0
                  const total = pb.template?.total_sessions || 0
                  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
                  
                  return (
                    <div key={pb.id} className="border border-gray-200 rounded-lg p-3">
                      <div className="font-medium text-gray-900 text-sm">{pb.template?.title || pb.title}</div>
                      <div className="text-xs text-gray-500 mt-1">{pb.template?.skill_category}</div>
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>Progress</span>
                          <span>{completed}/{total} sessions</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full" 
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Notes */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h4 className="font-semibold text-gray-900 flex items-center space-x-2">
                <StickyNote size={18} className="text-yellow-600" />
                <span>Player Notes</span>
                <span className="text-sm font-normal text-gray-500">({notes.length})</span>
              </h4>
              <button
                onClick={() => setShowAddNoteModal(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
              >
                <Plus size={16} />
                <span>Add Note</span>
              </button>
            </div>

            {notes.length === 0 ? (
              <div className="p-12 text-center">
                <StickyNote className="mx-auto text-gray-300 mb-4" size={48} />
                <p className="text-gray-600 mb-4">No notes for {player.name} yet</p>
                <button
                  onClick={() => setShowAddNoteModal(true)}
                  className="text-red-600 hover:text-red-700 font-medium"
                >
                  Add your first note
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notes.map((note) => (
                  <div key={note.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-gray-700 whitespace-pre-wrap">{note.note}</p>
                        <div className="flex items-center space-x-2 mt-2">
                          <Calendar size={14} className="text-gray-400" />
                          <span className="text-sm text-gray-500">{formatDate(note.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 ml-4">
                        <button
                          onClick={() => openEditNoteModal(note)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit note"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => confirmDeleteNote(note)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete note"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Note Modal */}
      {showAddNoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Add Note for {player.name}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note *
                </label>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="e.g., Needs work on follow-through when throwing..."
                  autoFocus
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowAddNoteModal(false)
                    setNewNote('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Note Modal */}
      {showEditNoteModal && noteToEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Edit Note</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note *
                </label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowEditNoteModal(false)
                    setNoteToEdit(null)
                    setEditNote('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditNote}
                  disabled={!editNote.trim()}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Note Confirmation Modal */}
      {showDeleteNoteModal && noteToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Note</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this note? This cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteNoteModal(false)
                  setNoteToDelete(null)
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteNote}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PlayerDetailPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <PlayerDetailContent />
    </Suspense>
  )
}
