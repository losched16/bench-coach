'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { ArrowLeft, User, Plus, Trash2, Pencil, StickyNote, Target, TrendingUp, Calendar, BookOpen, Gauge, FileText } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { usePageView } from '@/lib/tracking'
import { PlayerMetrics } from '@/components/PlayerMetrics'
import { PlayerHistory } from '@/components/PlayerHistory'
import { PlayerReports } from '@/components/PlayerReports'
import { useRole } from '@/lib/useRole'

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
    pitching_level: number | null
    baserunning_level: number | null
    coachability_level: number | null
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

const SKILL_CATEGORIES = [
  { key: 'hitting', label: 'Hitting', icon: '🏏' },
  { key: 'fielding', label: 'Fielding', icon: '🧤' },
  { key: 'throwing', label: 'Throwing', icon: '💪' },
  { key: 'pitching', label: 'Pitching', icon: '⚾' },
  { key: 'baserunning', label: 'Baserunning', icon: '🏃' },
  { key: 'coachability', label: 'Coachability', icon: '⭐' },
]

const SKILL_LABELS = ['', 'Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert']

function SkillRating({ 
  skill, 
  value, 
  onChange 
}: { 
  skill: { key: string; label: string; icon: string }
  value: number | null
  onChange: (level: number | null) => void
}) {
  const handleClick = (level: number) => {
    if (value === level) {
      onChange(null)
    } else {
      onChange(level)
    }
  }

  const getLabel = () => {
    if (!value) return 'Not rated'
    return SKILL_LABELS[value]
  }

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-2">
          <span className="text-base">{skill.icon}</span>
          <span className="text-gray-700 font-medium text-sm">{skill.label}</span>
        </div>
        <span className={`text-xs ${value ? 'text-gray-700' : 'text-gray-400'}`}>
          {getLabel()}
        </span>
      </div>
      <div className="flex space-x-1.5">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            onClick={() => handleClick(level)}
            className={`w-7 h-7 rounded-full border-2 transition-all ${
              value && value >= level
                ? level <= 1 ? 'bg-red-500 border-red-500' :
                  level <= 2 ? 'bg-orange-500 border-orange-500' :
                  level <= 3 ? 'bg-yellow-500 border-yellow-500' :
                  level <= 4 ? 'bg-green-500 border-green-500' :
                  'bg-blue-500 border-blue-500'
                : 'bg-white border-gray-300 hover:border-gray-400'
            }`}
            title={SKILL_LABELS[level]}
          />
        ))}
      </div>
    </div>
  )
}

function PlayerDetailContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const playerId = params.playerId as string
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  const [activeTab, setActiveTab] = useState<'overview' | 'measurements' | 'journal' | 'reports'>('overview')

  // Writing a development report is a 'decide' action — see the comment in
  // app/api/player-reports/route.ts. A contributor keeping the book may read
  // one; they do not author the document that goes to the family.
  const { can: allowed } = useRole(teamId)
  const [player, setPlayer] = useState<PlayerData | null>(null)
  const [notes, setNotes] = useState<PlayerNote[]>([])
  const [playbooks, setPlaybooks] = useState<ActivePlaybook[]>([])
  const [loading, setLoading] = useState(true)
  const [coachId, setCoachId] = useState<string | null>(null)
  const [savingSkill, setSavingSkill] = useState(false)
  
  const [showAddNoteModal, setShowAddNoteModal] = useState(false)
  const [showEditNoteModal, setShowEditNoteModal] = useState(false)
  const [showDeleteNoteModal, setShowDeleteNoteModal] = useState(false)
  const [noteToEdit, setNoteToEdit] = useState<PlayerNote | null>(null)
  const [noteToDelete, setNoteToDelete] = useState<PlayerNote | null>(null)
  const [newNote, setNewNote] = useState('')
  const [editNote, setEditNote] = useState('')

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Media state
  
  // Media viewer
  
  

  useEffect(() => {
    if (playerId && teamId) {
      loadPlayerData()
      loadCoachId()
    }
  }, [playerId, teamId])

  const loadCoachId = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: coach } = await supabase.from('coaches').select('id').eq('user_id', user.id).single()
      if (coach) setCoachId(coach.id)
    }
  }

  const loadPlayerData = async () => {
    setLoading(true)
    try {
      const { data: playerData } = await supabase.from('players').select('id, name, jersey_number').eq('id', playerId).single()
      const { data: teamPlayerData } = await supabase.from('team_players').select('id, positions, hitting_level, throwing_level, fielding_level, pitching_level, baserunning_level, coachability_level').eq('player_id', playerId).eq('team_id', teamId).single()
      if (playerData && teamPlayerData) setPlayer({ ...playerData, team_player: teamPlayerData })

      const { data: notesData } = await supabase.from('player_notes').select('*').eq('player_id', playerId).eq('team_id', teamId).order('created_at', { ascending: false })
      setNotes(notesData || [])

      const { data: playbooksData } = await supabase.from('player_playbooks').select('id, title, status, completed_sessions, template:playbook_templates(title, total_sessions, skill_category)').eq('player_id', playerId).eq('team_id', teamId)
      setPlaybooks(playbooksData || [])

    } catch (error) {
      console.error('Error loading player data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSkillChange = async (skillKey: string, level: number | null) => {
    if (!player) return
    
    setSavingSkill(true)
    try {
      const updateData = { [`${skillKey}_level`]: level }
      await supabase
        .from('team_players')
        .update(updateData)
        .eq('id', player.team_player.id)
      
      // Update local state immediately for responsiveness
      setPlayer(prev => prev ? {
        ...prev,
        team_player: {
          ...prev.team_player,
          [`${skillKey}_level`]: level
        }
      } : null)
    } catch (error) {
      console.error('Error updating skill level:', error)
    } finally {
      setSavingSkill(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim() || !teamId || !playerId) return
    try {
      await supabase.from('player_notes').insert({ team_id: teamId, player_id: playerId, note: newNote.trim() })
      setNewNote('')
      setShowAddNoteModal(false)
      loadPlayerData()
    } catch (error) {
      console.error('Error adding note:', error)
    }
  }

  const openEditNoteModal = (note: PlayerNote) => { setNoteToEdit(note); setEditNote(note.note); setShowEditNoteModal(true) }
  const handleEditNote = async () => {
    if (!editNote.trim() || !noteToEdit) return
    try {
      await supabase.from('player_notes').update({ note: editNote.trim() }).eq('id', noteToEdit.id)
      setShowEditNoteModal(false); setNoteToEdit(null); setEditNote(''); loadPlayerData()
    } catch (error) { console.error('Error updating note:', error) }
  }
  const confirmDeleteNote = (note: PlayerNote) => { setNoteToDelete(note); setShowDeleteNoteModal(true) }
  const handleDeleteNote = async () => {
    if (!noteToDelete) return
    try {
      await supabase.from('player_notes').delete().eq('id', noteToDelete.id)
      setShowDeleteNoteModal(false); setNoteToDelete(null); loadPlayerData()
    } catch (error) { console.error('Error deleting note:', error) }
  }

  if (loading) return <div className="text-gray-600">Loading player...</div>
  if (!player) return <div className="text-center py-12"><p className="text-gray-600 mb-4">Player not found</p><button onClick={() => router.push(`/dashboard/roster?teamId=${teamId}`)} className="text-red-600 hover:text-red-700">Back to roster</button></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <button onClick={() => router.push(`/dashboard/roster?teamId=${teamId}`)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
        <div className="flex items-center space-x-4 flex-1">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            {player.jersey_number ? <span className="text-2xl font-bold text-red-600">#{player.jersey_number}</span> : <User className="text-red-600" size={32} />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{player.name}</h1>
            {player.team_player.positions?.length > 0 && <p className="text-gray-500">{player.team_player.positions.join(', ')}</p>}
          </div>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-6 sm:space-x-8 overflow-x-auto -mb-px">
          <button onClick={() => setActiveTab('overview')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'overview' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <div className="flex items-center space-x-2"><User size={18} /><span>Overview</span></div>
          </button>
          <button onClick={() => setActiveTab('measurements')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'measurements' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <div className="flex items-center space-x-2"><Gauge size={18} /><span>Measurements</span></div>
          </button>
          <button onClick={() => setActiveTab('journal')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'journal' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <div className="flex items-center space-x-2"><BookOpen size={18} /><span>History</span></div>
          </button>
          <button onClick={() => setActiveTab('reports')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'reports' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <div className="flex items-center space-x-2"><FileText size={18} /><span>Reports</span></div>
          </button>
        </nav>
      </div>

      {activeTab === 'measurements' && (
        <PlayerMetrics
          coachId={coachId}
          playerId={playerId as string}
          playerName={player?.name || 'this player'}
          teamId={teamId}
        />
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900 flex items-center space-x-2">
                  <Target size={18} className="text-red-600" />
                  <span>Skill Levels</span>
                </h4>
                {savingSkill && <span className="text-xs text-gray-400">Saving...</span>}
              </div>
              <p className="text-xs text-gray-500 mb-4">Click dots to rate (click again to clear)</p>
              <div className="divide-y divide-gray-100">
                {SKILL_CATEGORIES.map(skill => (
                  <SkillRating
                    key={skill.key}
                    skill={skill}
                    value={player.team_player[`${skill.key}_level` as keyof typeof player.team_player] as number | null}
                    onChange={(level) => handleSkillChange(skill.key, level)}
                  />
                ))}
              </div>
            </div>
            {playbooks.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h4 className="font-semibold text-gray-900 mb-4 flex items-center space-x-2"><TrendingUp size={18} className="text-green-600" /><span>Active Playbooks</span></h4>
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
                          <div className="flex justify-between text-xs text-gray-600 mb-1"><span>Progress</span><span>{completed}/{total}</span></div>
                          <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-green-600 h-2 rounded-full" style={{ width: `${progress}%` }} /></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                <h4 className="font-semibold text-gray-900 flex items-center space-x-2"><StickyNote size={18} className="text-yellow-600" /><span>Player Notes</span><span className="text-sm font-normal text-gray-500">({notes.length})</span></h4>
                <button onClick={() => setShowAddNoteModal(true)} className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"><Plus size={16} /><span>Add Note</span></button>
              </div>
              {notes.length === 0 ? (
                <div className="p-12 text-center"><StickyNote className="mx-auto text-gray-300 mb-4" size={48} /><p className="text-gray-600 mb-4">No notes yet</p><button onClick={() => setShowAddNoteModal(true)} className="text-red-600 hover:text-red-700 font-medium">Add your first note</button></div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notes.map((note) => (
                    <div key={note.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1"><p className="text-gray-700 whitespace-pre-wrap">{note.note}</p><div className="flex items-center space-x-2 mt-2"><Calendar size={14} className="text-gray-400" /><span className="text-sm text-gray-500">{formatDate(note.created_at)}</span></div></div>
                        <div className="flex items-center space-x-1 ml-4">
                          <button onClick={() => openEditNoteModal(note)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={16} /></button>
                          <button onClick={() => confirmDeleteNote(note)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <PlayerReports
          playerId={playerId as string}
          teamId={teamId}
          playerName={player?.name || 'this player'}
          canCreate={allowed('decide')}
        />
      )}

      {activeTab === 'journal' && (
        <PlayerHistory
          coachId={coachId}
          playerId={playerId as string}
          playerName={player?.name || 'this player'}
          teamId={teamId}
        />
      )}

      {/* Note Modals */}
      {showAddNoteModal && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-4">Add Note</h3><textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={4} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Add a note..." autoFocus /><div className="flex space-x-3 mt-4"><button onClick={() => { setShowAddNoteModal(false); setNewNote('') }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleAddNote} disabled={!newNote.trim()} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Add Note</button></div></div></div>}
      {showEditNoteModal && noteToEdit && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-4">Edit Note</h3><textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={4} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" autoFocus /><div className="flex space-x-3 mt-4"><button onClick={() => { setShowEditNoteModal(false); setNoteToEdit(null); setEditNote('') }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleEditNote} disabled={!editNote.trim()} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Save</button></div></div></div>}
      {showDeleteNoteModal && noteToDelete && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-2">Delete Note</h3><p className="text-gray-600 mb-6">Are you sure? This cannot be undone.</p><div className="flex space-x-3"><button onClick={() => { setShowDeleteNoteModal(false); setNoteToDelete(null) }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleDeleteNote} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button></div></div></div>}

    </div>
  )
}

export default function PlayerDetailPage() {
  usePageView('roster_detail')
  return <Suspense fallback={<div className="text-gray-600">Loading...</div>}><PlayerDetailContent /></Suspense>
}
