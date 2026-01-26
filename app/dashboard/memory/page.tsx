'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { 
  Brain, Trash2, User, Users, Settings, AlertCircle, 
  StickyNote, Lightbulb, RefreshCw, Info
} from 'lucide-react'

interface TeamNote {
  id: string
  title?: string
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

interface CoachPreference {
  id: string
  key: string
  value: string
  created_at: string
}

function MemoryPageContent() {
  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([])
  const [playerNotes, setPlayerNotes] = useState<PlayerNote[]>([])
  const [coachPreferences, setCoachPreferences] = useState<CoachPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [coachId, setCoachId] = useState<string | null>(null)
  
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadMemory()
    }
  }, [teamId])

  const loadMemory = async () => {
    setLoading(true)
    try {
      // Load team info
      const { data: team } = await supabase
        .from('teams')
        .select('name, coach_id')
        .eq('id', teamId)
        .single()

      if (team) {
        setTeamName(team.name)
        setCoachId(team.coach_id)

        // Load coach preferences
        const { data: prefs } = await supabase
          .from('coach_preferences')
          .select('*')
          .eq('coach_id', team.coach_id)
          .order('created_at', { ascending: false })

        setCoachPreferences(prefs || [])
      }

      // Load team notes
      const { data: notes } = await supabase
        .from('team_notes')
        .select('*')
        .eq('team_id', teamId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })

      setTeamNotes(notes || [])

      // Load player notes with player names
      const { data: pNotes } = await supabase
        .from('player_notes')
        .select(`
          id,
          note,
          created_at,
          player:players(id, name)
        `)
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      setPlayerNotes(pNotes || [])

    } catch (error) {
      console.error('Error loading memory:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteTeamNote = async (id: string) => {
    setDeleting(id)
    try {
      const { error } = await supabase
        .from('team_notes')
        .delete()
        .eq('id', id)

      if (!error) {
        setTeamNotes(prev => prev.filter(n => n.id !== id))
      }
    } catch (error) {
      console.error('Error deleting team note:', error)
    } finally {
      setDeleting(null)
    }
  }

  const deletePlayerNote = async (id: string) => {
    setDeleting(id)
    try {
      const { error } = await supabase
        .from('player_notes')
        .delete()
        .eq('id', id)

      if (!error) {
        setPlayerNotes(prev => prev.filter(n => n.id !== id))
      }
    } catch (error) {
      console.error('Error deleting player note:', error)
    } finally {
      setDeleting(null)
    }
  }

  const deleteCoachPreference = async (id: string) => {
    setDeleting(id)
    try {
      const { error } = await supabase
        .from('coach_preferences')
        .delete()
        .eq('id', id)

      if (!error) {
        setCoachPreferences(prev => prev.filter(p => p.id !== id))
      }
    } catch (error) {
      console.error('Error deleting preference:', error)
    } finally {
      setDeleting(null)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatPreferenceKey = (key: string) => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
  }

  const totalMemoryItems = teamNotes.length + playerNotes.length + coachPreferences.length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
            <Brain className="text-red-600" size={28} />
            <span>AI Memory</span>
          </h2>
          <p className="text-gray-600 mt-1">
            Everything the AI knows about {teamName || 'your team'}
          </p>
        </div>
        <button
          onClick={loadMemory}
          className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw size={18} />
          <span className="text-sm">Refresh</span>
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-blue-800">
            <p className="font-medium">How AI Memory Works</p>
            <p className="mt-1">
              When you chat with Bench Coach, it can suggest saving important information. 
              This memory helps the AI give you personalized advice. You can delete anything 
              here that&apos;s outdated or no longer relevant.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center space-x-3">
            <div className="bg-yellow-100 text-yellow-600 p-2 rounded-lg">
              <StickyNote size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{teamNotes.length}</div>
              <div className="text-sm text-gray-500">Team Notes</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center space-x-3">
            <div className="bg-green-100 text-green-600 p-2 rounded-lg">
              <User size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{playerNotes.length}</div>
              <div className="text-sm text-gray-500">Player Notes</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center space-x-3">
            <div className="bg-purple-100 text-purple-600 p-2 rounded-lg">
              <Settings size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{coachPreferences.length}</div>
              <div className="text-sm text-gray-500">Preferences</div>
            </div>
          </div>
        </div>
      </div>

      {totalMemoryItems === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Brain className="mx-auto text-gray-300 mb-4" size={64} />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No memories yet</h3>
          <p className="text-gray-600 max-w-md mx-auto">
            As you use the AI Chat, Bench Coach will learn about your team and players. 
            Saved information will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Team Notes Section */}
          {teamNotes.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                  <StickyNote className="text-yellow-600" size={20} />
                  <span>Team Notes & Issues</span>
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  General observations and issues about the team
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {teamNotes.map((note) => (
                  <div key={note.id} className="p-4 flex items-start justify-between hover:bg-gray-50">
                    <div className="flex-1">
                      {note.title && (
                        <div className="font-medium text-gray-900 mb-1">{note.title}</div>
                      )}
                      <div className="text-gray-700">{note.note}</div>
                      <div className="flex items-center space-x-3 mt-2">
                        <span className="text-xs text-gray-400">{formatDate(note.created_at)}</span>
                        {note.pinned && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">
                            Pinned
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteTeamNote(note.id)}
                      disabled={deleting === note.id}
                      className="ml-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete note"
                    >
                      {deleting === note.id ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Player Notes Section */}
          {playerNotes.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                  <User className="text-green-600" size={20} />
                  <span>Player Notes</span>
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Individual observations about specific players
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {playerNotes.map((note) => (
                  <div key={note.id} className="p-4 flex items-start justify-between hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-medium text-gray-900">
                          {note.player?.name || 'Unknown Player'}
                        </span>
                      </div>
                      <div className="text-gray-700">{note.note}</div>
                      <div className="text-xs text-gray-400 mt-2">{formatDate(note.created_at)}</div>
                    </div>
                    <button
                      onClick={() => deletePlayerNote(note.id)}
                      disabled={deleting === note.id}
                      className="ml-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete note"
                    >
                      {deleting === note.id ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coach Preferences Section */}
          {coachPreferences.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                  <Settings className="text-purple-600" size={20} />
                  <span>Coach Preferences</span>
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Your coaching style and preferences learned from conversations
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {coachPreferences.map((pref) => (
                  <div key={pref.id} className="p-4 flex items-start justify-between hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">
                          {formatPreferenceKey(pref.key)}
                        </span>
                      </div>
                      <div className="text-gray-700 mt-1">{pref.value}</div>
                      <div className="text-xs text-gray-400 mt-2">{formatDate(pref.created_at)}</div>
                    </div>
                    <button
                      onClick={() => deleteCoachPreference(pref.id)}
                      disabled={deleting === pref.id}
                      className="ml-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete preference"
                    >
                      {deleting === pref.id ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer Info */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
        <div className="flex items-start space-x-2">
          <Lightbulb className="text-yellow-500 flex-shrink-0 mt-0.5" size={18} />
          <p>
            <strong>Tip:</strong> Regularly review and clean up outdated memories. 
            If a player has improved in an area, delete the old note so the AI gives 
            current advice. The AI also sees your roster, playbook progress, and practice 
            plans automatically.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function MemoryPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <MemoryPageContent />
    </Suspense>
  )
}
