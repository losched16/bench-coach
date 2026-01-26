'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, Pin, Trash2, Pencil, Users, User } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

interface TeamNote {
  id: string
  title: string | null
  note: string
  pinned: boolean
  created_at: string
}

interface PlayerNote {
  id: string
  note: string
  created_at: string
  player: {
    id: string
    name: string
  }
}

interface Player {
  id: string
  player: {
    id: string
    name: string
  }
}

function NotesPageContent() {
  const [activeTab, setActiveTab] = useState<'team' | 'player'>('team')
  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([])
  const [playerNotes, setPlayerNotes] = useState<PlayerNote[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  
  // Team note modal states
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [noteToEdit, setNoteToEdit] = useState<TeamNote | null>(null)
  const [noteToDelete, setNoteToDelete] = useState<TeamNote | null>(null)
  const [newNote, setNewNote] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editTitle, setEditTitle] = useState('')
  
  // Player note modal states
  const [showAddPlayerNoteModal, setShowAddPlayerNoteModal] = useState(false)
  const [showEditPlayerNoteModal, setShowEditPlayerNoteModal] = useState(false)
  const [showDeletePlayerNoteModal, setShowDeletePlayerNoteModal] = useState(false)
  const [playerNoteToEdit, setPlayerNoteToEdit] = useState<PlayerNote | null>(null)
  const [playerNoteToDelete, setPlayerNoteToDelete] = useState<PlayerNote | null>(null)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [newPlayerNote, setNewPlayerNote] = useState('')
  const [editPlayerNote, setEditPlayerNote] = useState('')
  
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
      // Load team notes
      const { data: teamNotesData } = await supabase
        .from('team_notes')
        .select('*')
        .eq('team_id', teamId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })

      setTeamNotes(teamNotesData || [])

      // Load player notes with player info
      const { data: playerNotesData } = await supabase
        .from('player_notes')
        .select(`
          id,
          note,
          created_at,
          player:players(id, name)
        `)
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      setPlayerNotes(playerNotesData || [])

      // Load players for dropdown
      const { data: playersData } = await supabase
        .from('team_players')
        .select(`
          id,
          player:players(id, name)
        `)
        .eq('team_id', teamId)

      setPlayers(playersData || [])
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Team note handlers
  const handleAddNote = async () => {
    if (!newNote.trim() || !teamId) return

    try {
      await supabase
        .from('team_notes')
        .insert({
          team_id: teamId,
          title: newTitle || null,
          note: newNote,
          pinned: false,
        })

      setNewNote('')
      setNewTitle('')
      setShowAddModal(false)
      loadData()
    } catch (error) {
      console.error('Error adding note:', error)
      alert('Failed to add note')
    }
  }

  const togglePin = async (id: string, currentPinned: boolean) => {
    try {
      await supabase
        .from('team_notes')
        .update({ pinned: !currentPinned })
        .eq('id', id)

      loadData()
    } catch (error) {
      console.error('Error toggling pin:', error)
    }
  }

  const openEditModal = (note: TeamNote) => {
    setNoteToEdit(note)
    setEditTitle(note.title || '')
    setEditNote(note.note)
    setShowEditModal(true)
  }

  const handleEditNote = async () => {
    if (!editNote.trim() || !noteToEdit) return

    try {
      await supabase
        .from('team_notes')
        .update({
          title: editTitle || null,
          note: editNote,
        })
        .eq('id', noteToEdit.id)

      setShowEditModal(false)
      setNoteToEdit(null)
      setEditTitle('')
      setEditNote('')
      loadData()
    } catch (error) {
      console.error('Error updating note:', error)
      alert('Failed to update note')
    }
  }

  const confirmDeleteNote = (note: TeamNote) => {
    setNoteToDelete(note)
    setShowDeleteModal(true)
  }

  const handleDeleteNote = async () => {
    if (!noteToDelete) return

    try {
      await supabase
        .from('team_notes')
        .delete()
        .eq('id', noteToDelete.id)

      setShowDeleteModal(false)
      setNoteToDelete(null)
      loadData()
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Failed to delete note')
    }
  }

  // Player note handlers
  const handleAddPlayerNote = async () => {
    if (!newPlayerNote.trim() || !selectedPlayerId || !teamId) return

    try {
      await supabase
        .from('player_notes')
        .insert({
          team_id: teamId,
          player_id: selectedPlayerId,
          note: newPlayerNote,
        })

      setNewPlayerNote('')
      setSelectedPlayerId('')
      setShowAddPlayerNoteModal(false)
      loadData()
    } catch (error) {
      console.error('Error adding player note:', error)
      alert('Failed to add note')
    }
  }

  const openEditPlayerNoteModal = (note: PlayerNote) => {
    setPlayerNoteToEdit(note)
    setEditPlayerNote(note.note)
    setShowEditPlayerNoteModal(true)
  }

  const handleEditPlayerNote = async () => {
    if (!editPlayerNote.trim() || !playerNoteToEdit) return

    try {
      await supabase
        .from('player_notes')
        .update({ note: editPlayerNote })
        .eq('id', playerNoteToEdit.id)

      setShowEditPlayerNoteModal(false)
      setPlayerNoteToEdit(null)
      setEditPlayerNote('')
      loadData()
    } catch (error) {
      console.error('Error updating note:', error)
      alert('Failed to update note')
    }
  }

  const confirmDeletePlayerNote = (note: PlayerNote) => {
    setPlayerNoteToDelete(note)
    setShowDeletePlayerNoteModal(true)
  }

  const handleDeletePlayerNote = async () => {
    if (!playerNoteToDelete) return

    try {
      await supabase
        .from('player_notes')
        .delete()
        .eq('id', playerNoteToDelete.id)

      setShowDeletePlayerNoteModal(false)
      setPlayerNoteToDelete(null)
      loadData()
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Failed to delete note')
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading notes...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Notes</h2>
        <button
          onClick={() => activeTab === 'team' ? setShowAddModal(true) : setShowAddPlayerNoteModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus size={20} />
          <span>Add Note</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('team')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
              activeTab === 'team'
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Users size={18} />
            <span>Team Notes</span>
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'team' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
            }`}>
              {teamNotes.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('player')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
              activeTab === 'player'
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <User size={18} />
            <span>Player Notes</span>
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'player' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
            }`}>
              {playerNotes.length}
            </span>
          </button>
        </nav>
      </div>

      {/* Team Notes Tab */}
      {activeTab === 'team' && (
        <>
          {teamNotes.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-gray-600 mb-4">No team notes yet</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Add Your First Team Note
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {teamNotes.map((note) => (
                <div
                  key={note.id}
                  className={`bg-white rounded-lg shadow p-6 ${
                    note.pinned ? 'border-2 border-yellow-400' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      {note.title && (
                        <h3 className="text-lg font-semibold text-gray-900 mb-1">
                          {note.title}
                        </h3>
                      )}
                      <p className="text-gray-700 whitespace-pre-wrap">{note.note}</p>
                    </div>
                    <div className="flex items-center space-x-1 ml-4">
                      <button
                        onClick={() => openEditModal(note)}
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
                      <button
                        onClick={() => togglePin(note.id, note.pinned)}
                        className={`p-2 rounded-lg transition-colors ${
                          note.pinned
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        title={note.pinned ? 'Unpin note' : 'Pin note'}
                      >
                        <Pin size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {formatDate(note.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Player Notes Tab */}
      {activeTab === 'player' && (
        <>
          {playerNotes.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-gray-600 mb-4">No player notes yet</p>
              {players.length > 0 ? (
                <button
                  onClick={() => setShowAddPlayerNoteModal(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Add Your First Player Note
                </button>
              ) : (
                <p className="text-sm text-gray-500">
                  <Link href={`/dashboard/roster?teamId=${teamId}`} className="text-red-600 hover:text-red-700">
                    Add players to your roster
                  </Link> first to create player notes.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {playerNotes.map((note) => (
                <div key={note.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <Link 
                        href={`/dashboard/roster/${note.player.id}?teamId=${teamId}`}
                        className="inline-flex items-center space-x-2 text-red-600 hover:text-red-700 font-medium mb-2"
                      >
                        <User size={16} />
                        <span>{note.player.name}</span>
                      </Link>
                      <p className="text-gray-700 whitespace-pre-wrap">{note.note}</p>
                    </div>
                    <div className="flex items-center space-x-1 ml-4">
                      <button
                        onClick={() => openEditPlayerNoteModal(note)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit note"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => confirmDeletePlayerNote(note)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete note"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {formatDate(note.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Team Note Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Add Team Note</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="e.g., Throwing Issues"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note *
                </label>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="What's happening with the team..."
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

      {/* Edit Team Note Modal */}
      {showEditModal && noteToEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Edit Note</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="e.g., Throwing Issues"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note *
                </label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="What's happening with the team..."
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowEditModal(false)
                    setNoteToEdit(null)
                    setEditTitle('')
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

      {/* Delete Team Note Confirmation Modal */}
      {showDeleteModal && noteToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Note</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete {noteToDelete.title ? <strong>&quot;{noteToDelete.title}&quot;</strong> : 'this note'}? This cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false)
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

      {/* Add Player Note Modal */}
      {showAddPlayerNoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Add Player Note</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Player *
                </label>
                <select
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="">Select a player...</option>
                  {players.map((p) => (
                    <option key={p.player.id} value={p.player.id}>
                      {p.player.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note *
                </label>
                <textarea
                  value={newPlayerNote}
                  onChange={(e) => setNewPlayerNote(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="e.g., Needs work on follow-through when throwing..."
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowAddPlayerNoteModal(false)
                    setSelectedPlayerId('')
                    setNewPlayerNote('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddPlayerNote}
                  disabled={!newPlayerNote.trim() || !selectedPlayerId}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Player Note Modal */}
      {showEditPlayerNoteModal && playerNoteToEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Edit Note for {playerNoteToEdit.player.name}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note *
                </label>
                <textarea
                  value={editPlayerNote}
                  onChange={(e) => setEditPlayerNote(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowEditPlayerNoteModal(false)
                    setPlayerNoteToEdit(null)
                    setEditPlayerNote('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditPlayerNote}
                  disabled={!editPlayerNote.trim()}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Player Note Confirmation Modal */}
      {showDeletePlayerNoteModal && playerNoteToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Note</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this note for <strong>{playerNoteToDelete.player.name}</strong>? This cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeletePlayerNoteModal(false)
                  setPlayerNoteToDelete(null)
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePlayerNote}
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

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <NotesPageContent />
    </Suspense>
  )
}