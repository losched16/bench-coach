'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { 
  ArrowLeft, User, Plus, Trash2, Pencil, StickyNote, 
  Target, TrendingUp, Calendar, BookOpen, 
  Clock, CheckCircle, AlertCircle, Home, Upload, X, Play, Image as ImageIcon
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

interface MediaItem {
  url: string
  type: 'image' | 'video'
  filename: string
  path: string
}

interface JournalEntry {
  id: string
  session_date: string
  session_type: string
  duration_minutes: number | null
  instructor_name: string | null
  focus_areas: string | null
  went_well: string | null
  needs_work: string | null
  home_drills: string | null
  notes: string | null
  skills: string[]
  media: MediaItem[]
  created_at: string
}

const SESSION_TYPES = [
  { value: 'lesson', label: 'Private Lesson', icon: '🎯' },
  { value: 'practice', label: 'Team Practice', icon: '⚾' },
  { value: 'game', label: 'Game', icon: '🏆' },
  { value: 'backyard', label: 'Backyard Training', icon: '🏠' },
  { value: 'camp', label: 'Camp/Clinic', icon: '🏕️' },
  { value: 'other', label: 'Other', icon: '📝' },
]

const SKILL_OPTIONS = ['Hitting', 'Fielding', 'Throwing', 'Catching', 'Baserunning', 'Pitching']

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
    // If clicking the same level, clear it
    if (value === level) {
      onChange(null)
    } else {
      onChange(level)
    }
  }

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center space-x-2">
        <span className="text-lg">{skill.icon}</span>
        <span className="text-gray-700 font-medium">{skill.label}</span>
      </div>
      <div className="flex items-center space-x-3">
        <div className="flex space-x-1">
          {[1, 2, 3, 4, 5].map((level) => (
            <button
              key={level}
              onClick={() => handleClick(level)}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
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
        <span className="text-sm text-gray-500 w-24 text-right">
          {value ? SKILL_LABELS[value] : 'Not rated'}
        </span>
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<'overview' | 'journal'>('overview')
  const [player, setPlayer] = useState<PlayerData | null>(null)
  const [notes, setNotes] = useState<PlayerNote[]>([])
  const [playbooks, setPlaybooks] = useState<ActivePlaybook[]>([])
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
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

  const [showJournalModal, setShowJournalModal] = useState(false)
  const [journalToEdit, setJournalToEdit] = useState<JournalEntry | null>(null)
  const [showDeleteJournalModal, setShowDeleteJournalModal] = useState(false)
  const [journalToDelete, setJournalToDelete] = useState<JournalEntry | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Media state
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [existingMedia, setExistingMedia] = useState<MediaItem[]>([])
  const [mediaToDelete, setMediaToDelete] = useState<string[]>([])
  
  // Media viewer
  const [viewingMedia, setViewingMedia] = useState<MediaItem | null>(null)
  
  const [journalForm, setJournalForm] = useState({
    session_date: new Date().toISOString().split('T')[0],
    session_type: 'lesson',
    duration_minutes: 60,
    instructor_name: '',
    focus_areas: '',
    went_well: '',
    needs_work: '',
    home_drills: '',
    notes: '',
    skills: [] as string[],
  })

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

      const { data: journalData } = await supabase.from('player_journal_entries').select('*').eq('player_id', playerId).eq('team_id', teamId).order('session_date', { ascending: false })
      
      // Process journal entries to get signed URLs for media
      const processedEntries = await Promise.all((journalData || []).map(async (entry) => {
        if (entry.media && entry.media.length > 0) {
          const mediaWithUrls = await Promise.all(entry.media.map(async (m: MediaItem) => {
            const { data } = await supabase.storage.from('journal-media').createSignedUrl(m.path, 3600)
            return { ...m, url: data?.signedUrl || m.url }
          }))
          return { ...entry, media: mediaWithUrls }
        }
        return { ...entry, media: entry.media || [] }
      }))
      
      setJournalEntries(processedEntries)
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

  const resetJournalForm = () => {
    setJournalForm({ session_date: new Date().toISOString().split('T')[0], session_type: 'lesson', duration_minutes: 60, instructor_name: '', focus_areas: '', went_well: '', needs_work: '', home_drills: '', notes: '', skills: [] })
    setPendingFiles([])
    setExistingMedia([])
    setMediaToDelete([])
  }
  
  const openAddJournalModal = () => { resetJournalForm(); setJournalToEdit(null); setShowJournalModal(true) }
  
  const openEditJournalModal = (entry: JournalEntry) => {
    setJournalToEdit(entry)
    setJournalForm({ session_date: entry.session_date, session_type: entry.session_type, duration_minutes: entry.duration_minutes || 60, instructor_name: entry.instructor_name || '', focus_areas: entry.focus_areas || '', went_well: entry.went_well || '', needs_work: entry.needs_work || '', home_drills: entry.home_drills || '', notes: entry.notes || '', skills: entry.skills || [] })
    setExistingMedia(entry.media || [])
    setPendingFiles([])
    setMediaToDelete([])
    setShowJournalModal(true)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(f => {
      const isImage = f.type.startsWith('image/')
      const isVideo = f.type.startsWith('video/')
      const isValidSize = f.size <= 100 * 1024 * 1024 // 100MB limit
      return (isImage || isVideo) && isValidSize
    })
    setPendingFiles(prev => [...prev, ...validFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  const markMediaForDelete = (path: string) => {
    setMediaToDelete(prev => [...prev, path])
    setExistingMedia(prev => prev.filter(m => m.path !== path))
  }

  const uploadMedia = async (entryId: string): Promise<MediaItem[]> => {
    const uploadedMedia: MediaItem[] = []
    
    for (const file of pendingFiles) {
      const fileExt = file.name.split('.').pop()
      const fileName = `${playerId}/${entryId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      
      const { error } = await supabase.storage
        .from('journal-media')
        .upload(fileName, file)
      
      if (!error) {
        uploadedMedia.push({
          url: '',
          type: file.type.startsWith('image/') ? 'image' : 'video',
          filename: file.name,
          path: fileName,
        })
      } else {
        console.error('Upload error:', error)
      }
    }
    
    return uploadedMedia
  }

  const deleteMedia = async (paths: string[]) => {
    if (paths.length === 0) return
    await supabase.storage.from('journal-media').remove(paths)
  }

  const handleSaveJournalEntry = async () => {
    if (!teamId || !playerId || !coachId) return
    setSaving(true)
    
    try {
      let entryId = journalToEdit?.id
      
      if (journalToEdit && mediaToDelete.length > 0) {
        await deleteMedia(mediaToDelete)
      }
      
      const baseData = { 
        player_id: playerId, 
        team_id: teamId, 
        coach_id: coachId, 
        session_date: journalForm.session_date, 
        session_type: journalForm.session_type, 
        duration_minutes: journalForm.duration_minutes || null, 
        instructor_name: journalForm.instructor_name || null, 
        focus_areas: journalForm.focus_areas || null, 
        went_well: journalForm.went_well || null, 
        needs_work: journalForm.needs_work || null, 
        home_drills: journalForm.home_drills || null, 
        notes: journalForm.notes || null, 
        skills: journalForm.skills 
      }
      
      if (journalToEdit) {
        await supabase.from('player_journal_entries').update(baseData).eq('id', journalToEdit.id)
      } else {
        const { data } = await supabase.from('player_journal_entries').insert(baseData).select('id').single()
        entryId = data?.id
      }
      
      if (entryId && pendingFiles.length > 0) {
        setUploading(true)
        const newMedia = await uploadMedia(entryId)
        const allMedia = [...existingMedia, ...newMedia]
        await supabase.from('player_journal_entries')
          .update({ media: allMedia })
          .eq('id', entryId)
        setUploading(false)
      } else if (journalToEdit && mediaToDelete.length > 0) {
        await supabase.from('player_journal_entries')
          .update({ media: existingMedia })
          .eq('id', journalToEdit.id)
      }
      
      setShowJournalModal(false)
      resetJournalForm()
      setJournalToEdit(null)
      loadPlayerData()
    } catch (error) { 
      console.error('Error saving journal entry:', error) 
    } finally {
      setSaving(false)
      setUploading(false)
    }
  }

  const confirmDeleteJournal = (entry: JournalEntry) => { setJournalToDelete(entry); setShowDeleteJournalModal(true) }
  
  const handleDeleteJournal = async () => {
    if (!journalToDelete) return
    try {
      if (journalToDelete.media && journalToDelete.media.length > 0) {
        const paths = journalToDelete.media.map(m => m.path)
        await deleteMedia(paths)
      }
      
      await supabase.from('player_journal_entries').delete().eq('id', journalToDelete.id)
      setShowDeleteJournalModal(false); setJournalToDelete(null); loadPlayerData()
    } catch (error) { console.error('Error deleting journal entry:', error) }
  }

  const toggleSkill = (skill: string) => setJournalForm(prev => ({ ...prev, skills: prev.skills.includes(skill) ? prev.skills.filter(s => s !== skill) : [...prev.skills, skill] }))
  const getSessionTypeInfo = (type: string) => SESSION_TYPES.find(t => t.value === type) || SESSION_TYPES[5]

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
        <nav className="flex space-x-8">
          <button onClick={() => setActiveTab('overview')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'overview' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <div className="flex items-center space-x-2"><User size={18} /><span>Overview</span></div>
          </button>
          <button onClick={() => setActiveTab('journal')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'journal' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <div className="flex items-center space-x-2"><BookOpen size={18} /><span>Development Journal</span>{journalEntries.length > 0 && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{journalEntries.length}</span>}</div>
          </button>
        </nav>
      </div>

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

      {activeTab === 'journal' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div><h2 className="text-lg font-semibold text-gray-900">Development Journal</h2><p className="text-sm text-gray-500">Track lessons, practices, and progress over time</p></div>
            <button onClick={openAddJournalModal} className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"><Plus size={18} /><span>Add Entry</span></button>
          </div>
          {journalEntries.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <BookOpen className="mx-auto text-gray-300 mb-4" size={64} />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No journal entries yet</h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">Start documenting {player.name}&apos;s development journey. Track lessons, practices, what&apos;s working, and what to focus on next.</p>
              <button onClick={openAddJournalModal} className="inline-flex items-center space-x-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"><Plus size={18} /><span>Add First Entry</span></button>
            </div>
          ) : (
            <div className="space-y-4">
              {journalEntries.map((entry) => {
                const sessionType = getSessionTypeInfo(entry.session_type)
                return (
                  <div key={entry.id} className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                      <div className="flex items-center space-x-4">
                        <span className="text-2xl">{sessionType.icon}</span>
                        <div>
                          <div className="font-semibold text-gray-900">{sessionType.label}{entry.instructor_name && <span className="font-normal text-gray-500"> with {entry.instructor_name}</span>}</div>
                          <div className="flex items-center space-x-3 text-sm text-gray-500">
                            <span className="flex items-center space-x-1"><Calendar size={14} /><span>{new Date(entry.session_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></span>
                            {entry.duration_minutes && <span className="flex items-center space-x-1"><Clock size={14} /><span>{entry.duration_minutes} min</span></span>}
                            {entry.media && entry.media.length > 0 && <span className="flex items-center space-x-1"><ImageIcon size={14} /><span>{entry.media.length} media</span></span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {entry.skills?.length > 0 && <div className="hidden sm:flex flex-wrap gap-1">{entry.skills.map(skill => <span key={skill} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{skill}</span>)}</div>}
                        <button onClick={() => openEditJournalModal(entry)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={16} /></button>
                        <button onClick={() => confirmDeleteJournal(entry)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {entry.focus_areas && <div className="space-y-1"><div className="flex items-center space-x-2 text-sm font-medium text-gray-700"><Target size={14} className="text-blue-600" /><span>What We Worked On</span></div><p className="text-gray-600 text-sm whitespace-pre-wrap pl-5">{entry.focus_areas}</p></div>}
                      {entry.went_well && <div className="space-y-1"><div className="flex items-center space-x-2 text-sm font-medium text-gray-700"><CheckCircle size={14} className="text-green-600" /><span>What Went Well</span></div><p className="text-gray-600 text-sm whitespace-pre-wrap pl-5">{entry.went_well}</p></div>}
                      {entry.needs_work && <div className="space-y-1"><div className="flex items-center space-x-2 text-sm font-medium text-gray-700"><AlertCircle size={14} className="text-orange-600" /><span>Needs Work</span></div><p className="text-gray-600 text-sm whitespace-pre-wrap pl-5">{entry.needs_work}</p></div>}
                      {entry.home_drills && <div className="space-y-1"><div className="flex items-center space-x-2 text-sm font-medium text-gray-700"><Home size={14} className="text-purple-600" /><span>At-Home Drills</span></div><p className="text-gray-600 text-sm whitespace-pre-wrap pl-5">{entry.home_drills}</p></div>}
                      {entry.notes && <div className="space-y-1 md:col-span-2"><div className="flex items-center space-x-2 text-sm font-medium text-gray-700"><StickyNote size={14} className="text-gray-600" /><span>Notes</span></div><p className="text-gray-600 text-sm whitespace-pre-wrap pl-5">{entry.notes}</p></div>}
                    </div>
                    
                    {/* Media Gallery */}
                    {entry.media && entry.media.length > 0 && (
                      <div className="px-4 pb-4">
                        <div className="flex items-center space-x-2 text-sm font-medium text-gray-700 mb-2">
                          <ImageIcon size={14} className="text-indigo-600" />
                          <span>Photos & Videos</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {entry.media.map((media, idx) => (
                            <div 
                              key={idx} 
                              className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => setViewingMedia(media)}
                            >
                              {media.type === 'image' ? (
                                <img src={media.url} alt={media.filename} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gray-800">
                                  <Play className="text-white" size={32} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Note Modals */}
      {showAddNoteModal && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-4">Add Note</h3><textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={4} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Add a note..." autoFocus /><div className="flex space-x-3 mt-4"><button onClick={() => { setShowAddNoteModal(false); setNewNote('') }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleAddNote} disabled={!newNote.trim()} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Add Note</button></div></div></div>}
      {showEditNoteModal && noteToEdit && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-4">Edit Note</h3><textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={4} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" autoFocus /><div className="flex space-x-3 mt-4"><button onClick={() => { setShowEditNoteModal(false); setNoteToEdit(null); setEditNote('') }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleEditNote} disabled={!editNote.trim()} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Save</button></div></div></div>}
      {showDeleteNoteModal && noteToDelete && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-2">Delete Note</h3><p className="text-gray-600 mb-6">Are you sure? This cannot be undone.</p><div className="flex space-x-3"><button onClick={() => { setShowDeleteNoteModal(false); setNoteToDelete(null) }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleDeleteNote} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button></div></div></div>}

      {/* Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 sticky top-0 bg-white"><h3 className="text-xl font-bold text-gray-900">{journalToEdit ? 'Edit' : 'Add'} Journal Entry</h3><p className="text-sm text-gray-500 mt-1">Document this training session for {player.name}</p></div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-2">Date *</label><input type="date" value={journalForm.session_date} onChange={(e) => setJournalForm(prev => ({ ...prev, session_date: e.target.value }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-2">Session Type *</label><select value={journalForm.session_type} onChange={(e) => setJournalForm(prev => ({ ...prev, session_type: e.target.value }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500">{SESSION_TYPES.map(type => <option key={type.value} value={type.value}>{type.icon} {type.label}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-2">Duration (min)</label><input type="number" value={journalForm.duration_minutes} onChange={(e) => setJournalForm(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 0 }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" /></div>
              </div>
              {journalForm.session_type === 'lesson' && <div><label className="block text-sm font-medium text-gray-700 mb-2">Instructor Name</label><input type="text" value={journalForm.instructor_name} onChange={(e) => setJournalForm(prev => ({ ...prev, instructor_name: e.target.value }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="e.g., Coach Johnson" /></div>}
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Skills Worked On</label><div className="flex flex-wrap gap-2">{SKILL_OPTIONS.map(skill => <button key={skill} type="button" onClick={() => toggleSkill(skill)} className={`px-3 py-1.5 rounded-full text-sm font-medium ${journalForm.skills.includes(skill) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{skill}</button>)}</div></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2"><Target size={14} className="inline text-blue-600 mr-1" />What We Worked On</label><textarea value={journalForm.focus_areas} onChange={(e) => setJournalForm(prev => ({ ...prev, focus_areas: e.target.value }))} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Main focus areas..." /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2"><CheckCircle size={14} className="inline text-green-600 mr-1" />What Went Well</label><textarea value={journalForm.went_well} onChange={(e) => setJournalForm(prev => ({ ...prev, went_well: e.target.value }))} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Wins and improvements..." /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2"><AlertCircle size={14} className="inline text-orange-600 mr-1" />Needs Work</label><textarea value={journalForm.needs_work} onChange={(e) => setJournalForm(prev => ({ ...prev, needs_work: e.target.value }))} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Areas to improve..." /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2"><Home size={14} className="inline text-purple-600 mr-1" />At-Home Drills</label><textarea value={journalForm.home_drills} onChange={(e) => setJournalForm(prev => ({ ...prev, home_drills: e.target.value }))} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Drills to practice at home..." /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2"><StickyNote size={14} className="inline text-gray-600 mr-1" />Additional Notes</label><textarea value={journalForm.notes} onChange={(e) => setJournalForm(prev => ({ ...prev, notes: e.target.value }))} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500" placeholder="Other observations..." /></div>
              
              {/* Media Upload Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <ImageIcon size={14} className="inline text-indigo-600 mr-1" />
                  Photos & Videos
                </label>
                
                {existingMedia.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-2">Existing media:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {existingMedia.map((media, idx) => (
                        <div key={idx} className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
                          {media.type === 'image' ? (
                            <img src={media.url} alt={media.filename} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-800">
                              <Play className="text-white" size={24} />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => markMediaForDelete(media.path)}
                            className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {pendingFiles.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-2">New files to upload:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {pendingFiles.map((file, idx) => (
                        <div key={idx} className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
                          {file.type.startsWith('image/') ? (
                            <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-800">
                              <Play className="text-white" size={24} />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => removePendingFile(idx)}
                            className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700"
                          >
                            <X size={14} />
                          </button>
                          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate">
                            {file.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:bg-gray-50 text-gray-600 w-full justify-center"
                >
                  <Upload size={18} />
                  <span>Add Photos or Videos</span>
                </button>
                <p className="text-xs text-gray-500 mt-1">Max 100MB per file. Supports images and videos.</p>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex space-x-3 sticky bottom-0 bg-white">
              <button onClick={() => { setShowJournalModal(false); resetJournalForm(); setJournalToEdit(null) }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50" disabled={saving}>Cancel</button>
              <button onClick={handleSaveJournalEntry} disabled={saving} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {saving ? (uploading ? 'Uploading...' : 'Saving...') : (journalToEdit ? 'Save Changes' : 'Add Entry')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Journal Modal */}
      {showDeleteJournalModal && journalToDelete && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 max-w-md w-full mx-4"><h3 className="text-xl font-bold text-gray-900 mb-2">Delete Journal Entry</h3><p className="text-gray-600 mb-6">Are you sure? This will also delete all photos and videos. This cannot be undone.</p><div className="flex space-x-3"><button onClick={() => { setShowDeleteJournalModal(false); setJournalToDelete(null) }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button><button onClick={handleDeleteJournal} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button></div></div></div>}

      {/* Media Viewer Modal */}
      {viewingMedia && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4" onClick={() => setViewingMedia(null)}>
          <button className="absolute top-4 right-4 text-white hover:text-gray-300" onClick={() => setViewingMedia(null)}>
            <X size={32} />
          </button>
          <div className="max-w-4xl max-h-[90vh] w-full" onClick={e => e.stopPropagation()}>
            {viewingMedia.type === 'image' ? (
              <img src={viewingMedia.url} alt={viewingMedia.filename} className="w-full h-full object-contain" />
            ) : (
              <video src={viewingMedia.url} controls autoPlay className="w-full h-full" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PlayerDetailPage() {
  return <Suspense fallback={<div className="text-gray-600">Loading...</div>}><PlayerDetailContent /></Suspense>
}
