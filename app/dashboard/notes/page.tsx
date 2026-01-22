'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, Pin } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface TeamNote {
  id: string
  title: string | null
  note: string
  pinned: boolean
  created_at: string
}

export default function NotesPage() {
  const [notes, setNotes] = useState<TeamNote[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadNotes()
    }
  }, [teamId])

  const loadNotes = async () => {
    try {
      const { data } = await supabase
        .from('team_notes')
        .select('*')
        .eq('team_id', teamId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })

      if (data) {
        setNotes(data)
      }
    } catch (error) {
      console.error('Error loading notes:', error)
    } finally {
      setLoading(false)
    }
  }

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
      loadNotes()
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

      loadNotes()
    } catch (error) {
      console.error('Error toggling pin:', error)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading notes...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Team Notes</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          <span>Add Note</span>
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-600 mb-4">No notes yet</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Your First Note
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
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
                <button
                  onClick={() => togglePin(note.id, note.pinned)}
                  className={`ml-4 p-2 rounded-lg transition-colors ${
                    note.pinned
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Pin size={16} />
                </button>
              </div>
              <div className="text-sm text-gray-500">
                {formatDate(note.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Note Modal */}
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
