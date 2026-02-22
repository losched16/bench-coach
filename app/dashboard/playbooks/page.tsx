'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Book, Play, CheckCircle, Circle, Users, Clock, Target, ChevronDown, ChevronUp, Plus, Trash2, RotateCcw, X, ChevronLeft, ChevronRight, Lightbulb, AlertTriangle, Home } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { DrillVideoLookup } from '@/components/DrillVideo'
import { useDrillResources } from '@/lib/useDrillResources'

interface PlaybookTemplate {
  id: string
  title: string
  description: string
  goal: string
  age_group: string
  skill_category: string
  total_sessions: number
  sessions_per_week: number
  difficulty: string
  equipment: string[]
  sessions: any
}

interface PlayerPlaybook {
  id: string
  team_id: string
  player_id: string | null
  playbook_template_id: string
  title: string
  started_at: string
  completed_sessions: number[]
  status: string
  playbook_template?: PlaybookTemplate
  player?: { name: string }
}

interface Player {
  id: string
  player_id: string
  player: { id: string; name: string }
}

interface SessionDetail {
  day: number
  title: string
  phase: string
  duration_minutes: number
  goal: string
  why_this_matters: string
  equipment: string[]
  activities: Array<{
    name: string
    duration: string
    setup: string
    instructions: string
    reps: string
    coaching_cues: string[]
    success_indicator: string
  }>
  common_problems: Array<{
    problem: string
    solution: string
  }>
  parent_homework: string
}

function PlaybooksPageContent() {
  const [activeTab, setActiveTab] = useState<'library' | 'active'>('active')
  const [templates, setTemplates] = useState<PlaybookTemplate[]>([])
  const [activePlaybooks, setActivePlaybooks] = useState<PlayerPlaybook[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null)
  const [expandedPlaybook, setExpandedPlaybook] = useState<string | null>(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<PlaybookTemplate | null>(null)
  const [assignTo, setAssignTo] = useState<'team' | 'player'>('team')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('')
  const [assigning, setAssigning] = useState(false)
  
  // Session detail view state
  const [viewingSession, setViewingSession] = useState<{
    playbook: PlayerPlaybook | null
    session: SessionDetail | null
    sessionIndex: number
  } | null>(null)
  
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()
  const { drills: drillResources } = useDrillResources()

  useEffect(() => {
    if (teamId) {
      loadData()
    }
  }, [teamId])

  const loadData = async () => {
    setLoading(true)
    try {
      const { data: templateData } = await supabase
        .from('playbook_templates')
        .select('*')
        .order('skill_category')

      if (templateData) setTemplates(templateData)

      const { data: playbookData } = await supabase
        .from('player_playbooks')
        .select(`
          *,
          playbook_template:playbook_templates(*),
          player:players(name)
        `)
        .eq('team_id', teamId)
        .in('status', ['active', 'paused'])
        .order('started_at', { ascending: false })

      if (playbookData) setActivePlaybooks(playbookData)

      const { data: playerData } = await supabase
        .from('team_players')
        .select('id, player_id, player:players(id, name)')
        .eq('team_id', teamId)

      if (playerData) setPlayers(playerData)

    } catch (error) {
      console.error('Error loading playbooks:', error)
    } finally {
      setLoading(false)
    }
  }

  const openAssignModal = (template: PlaybookTemplate) => {
    setSelectedTemplate(template)
    setAssignTo('team')
    setSelectedPlayerId('')
    setShowAssignModal(true)
  }

  const handleAssign = async () => {
    if (!selectedTemplate || !teamId) return

    setAssigning(true)
    try {
      const { error } = await supabase
        .from('player_playbooks')
        .insert({
          team_id: teamId,
          player_id: assignTo === 'player' ? selectedPlayerId : null,
          playbook_template_id: selectedTemplate.id,
          title: selectedTemplate.title,
          completed_sessions: [],
          status: 'active'
        })

      if (error) throw error

      setShowAssignModal(false)
      loadData()
    } catch (error) {
      console.error('Error assigning playbook:', error)
      alert('Failed to assign playbook')
    } finally {
      setAssigning(false)
    }
  }

  const toggleSession = async (playbook: PlayerPlaybook, sessionDay: number) => {
    const completed = playbook.completed_sessions || []
    const newCompleted = completed.includes(sessionDay)
      ? completed.filter(d => d !== sessionDay)
      : [...completed, sessionDay].sort((a, b) => a - b)

    try {
      const { error } = await supabase
        .from('player_playbooks')
        .update({ 
          completed_sessions: newCompleted,
          status: newCompleted.length === playbook.playbook_template?.total_sessions ? 'completed' : 'active'
        })
        .eq('id', playbook.id)

      if (error) throw error

      setActivePlaybooks(prev => prev.map(p => 
        p.id === playbook.id 
          ? { ...p, completed_sessions: newCompleted }
          : p
      ))
      
      // Update viewing session if open
      if (viewingSession?.playbook?.id === playbook.id) {
        setViewingSession(prev => prev ? {
          ...prev,
          playbook: { ...prev.playbook!, completed_sessions: newCompleted }
        } : null)
      }
    } catch (error) {
      console.error('Error updating progress:', error)
    }
  }

  const deletePlaybook = async (playbookId: string) => {
    if (!confirm('Are you sure you want to remove this playbook?')) return

    try {
      await supabase
        .from('player_playbooks')
        .delete()
        .eq('id', playbookId)

      setActivePlaybooks(prev => prev.filter(p => p.id !== playbookId))
    } catch (error) {
      console.error('Error deleting playbook:', error)
    }
  }

  const getProgress = (playbook: PlayerPlaybook) => {
    const completed = playbook.completed_sessions?.length || 0
    const total = playbook.playbook_template?.total_sessions || 1
    return Math.round((completed / total) * 100)
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'fielding': return 'bg-green-100 text-green-700'
      case 'hitting': return 'bg-red-100 text-red-700'
      case 'throwing': return 'bg-blue-100 text-blue-700'
      case 'baserunning': return 'bg-orange-100 text-orange-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'Foundation': return 'bg-blue-100 text-blue-700'
      case 'Building Confidence': return 'bg-yellow-100 text-yellow-700'
      case 'Building Accuracy': return 'bg-yellow-100 text-yellow-700'
      case 'Building Strength': return 'bg-orange-100 text-orange-700'
      case 'Intermediate Skills': return 'bg-orange-100 text-orange-700'
      case 'Intermediate': return 'bg-orange-100 text-orange-700'
      case 'Game Situations': return 'bg-purple-100 text-purple-700'
      case 'Game Application': return 'bg-purple-100 text-purple-700'
      case 'Game Preparation': return 'bg-purple-100 text-purple-700'
      case 'Advanced Integration': return 'bg-red-100 text-red-700'
      case 'Advanced Skills': return 'bg-red-100 text-red-700'
      case 'Position Specific': return 'bg-indigo-100 text-indigo-700'
      case 'Refinement': return 'bg-teal-100 text-teal-700'
      case 'Assessment': return 'bg-green-100 text-green-700'
      case 'Mastery': return 'bg-green-100 text-green-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const openSessionDetail = (playbook: PlayerPlaybook, session: SessionDetail, index: number) => {
    setViewingSession({ playbook, session, sessionIndex: index })
  }

  const navigateSession = (direction: 'prev' | 'next') => {
    if (!viewingSession?.playbook?.playbook_template?.sessions?.sessions) return
    
    const sessions = viewingSession.playbook.playbook_template.sessions.sessions
    const newIndex = direction === 'prev' 
      ? viewingSession.sessionIndex - 1 
      : viewingSession.sessionIndex + 1
    
    if (newIndex >= 0 && newIndex < sessions.length) {
      setViewingSession({
        ...viewingSession,
        session: sessions[newIndex],
        sessionIndex: newIndex
      })
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading playbooks...</div>
  }

  // Session Detail View
  if (viewingSession?.session && viewingSession?.playbook) {
    const session = viewingSession.session
    const playbook = viewingSession.playbook
    const isCompleted = playbook.completed_sessions?.includes(session.day)
    const sessions = playbook.playbook_template?.sessions?.sessions || []
    const canGoPrev = viewingSession.sessionIndex > 0
    const canGoNext = viewingSession.sessionIndex < sessions.length - 1

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setViewingSession(null)}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft size={20} className="mr-1" />
            Back to Playbook
          </button>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => navigateSession('prev')}
              disabled={!canGoPrev}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm text-gray-500">
              Day {session.day} of {sessions.length}
            </span>
            <button
              onClick={() => navigateSession('next')}
              disabled={!canGoNext}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Session Header Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-sm font-medium text-gray-500">Day {session.day}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${getPhaseColor(session.phase)}`}>
                  {session.phase}
                </span>
                <span className="flex items-center text-sm text-gray-500">
                  <Clock size={14} className="mr-1" />
                  {session.duration_minutes} min
                </span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{session.title}</h2>
              <p className="text-gray-600 mt-1">{session.goal}</p>
            </div>
            <button
              onClick={() => toggleSession(playbook, session.day)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isCompleted
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {isCompleted ? (
                <>
                  <CheckCircle size={20} />
                  <span>Completed</span>
                </>
              ) : (
                <>
                  <Circle size={20} />
                  <span>Mark Complete</span>
                </>
              )}
            </button>
          </div>

          {/* Why This Matters */}
          {session.why_this_matters && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-start space-x-2">
                <Lightbulb className="text-blue-600 flex-shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="font-medium text-blue-900">Why This Matters</div>
                  <div className="text-sm text-blue-700 mt-1">{session.why_this_matters}</div>
                </div>
              </div>
            </div>
          )}

          {/* Equipment */}
          {session.equipment && session.equipment.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2">Equipment Needed:</div>
              <div className="flex flex-wrap gap-2">
                {session.equipment.map((item, idx) => (
                  <span key={idx} className="text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Activities/Drills */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900">
              Drills & Activities ({session.activities?.length || 0})
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {session.activities?.map((activity, idx) => (
              <div key={idx} className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">
                        {idx + 1}
                      </span>
                      <h4 className="font-semibold text-gray-900 text-lg">{activity.name}</h4>
                    </div>
                    <div className="flex items-center space-x-3 mt-1 text-sm text-gray-500">
                      <span className="flex items-center">
                        <Clock size={14} className="mr-1" />
                        {activity.duration}
                      </span>
                      {activity.reps && (
                        <span>• {activity.reps}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Setup */}
                {activity.setup && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-gray-700 mb-1">Setup:</div>
                    <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                      {activity.setup}
                    </div>
                  </div>
                )}

                {/* Instructions */}
                <div className="mb-4">
                  <div className="text-sm font-medium text-gray-700 mb-1">Instructions:</div>
                  <div className="text-sm text-gray-600">
                    {activity.instructions}
                  </div>
                </div>

                {/* Coaching Cues */}
                {activity.coaching_cues && activity.coaching_cues.length > 0 && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">Coaching Cues (say these!):</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {activity.coaching_cues.map((cue, cueIdx) => (
                        <div key={cueIdx} className="flex items-start space-x-2 text-sm">
                          <span className="text-blue-500 font-bold">"</span>
                          <span className="text-gray-700 italic">{cue}</span>
                          <span className="text-blue-500 font-bold">"</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Success Indicator */}
                {activity.success_indicator && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="text-green-600 flex-shrink-0 mt-0.5" size={16} />
                      <div>
                        <span className="text-sm font-medium text-green-800">Success looks like: </span>
                        <span className="text-sm text-green-700">{activity.success_indicator}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Embedded Drill Video */}
                <DrillVideoLookup
                  drillName={activity.name}
                  drillResources={drillResources}
                  compact={true}
                  autoExpand={false}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Common Problems */}
        {session.common_problems && session.common_problems.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <AlertTriangle className="text-yellow-500 mr-2" size={20} />
                Common Problems & Solutions
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {session.common_problems.map((item, idx) => (
                <div key={idx} className="p-4">
                  <div className="flex items-start space-x-3">
                    <div className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded flex-shrink-0">
                      Problem
                    </div>
                    <div className="flex-1">
                      <div className="text-gray-900 font-medium">{item.problem}</div>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 mt-2 ml-0 md:ml-16">
                    <div className="bg-green-100 text-green-600 text-xs font-bold px-2 py-1 rounded flex-shrink-0">
                      Solution
                    </div>
                    <div className="flex-1">
                      <div className="text-gray-600">{item.solution}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parent Homework */}
        {session.parent_homework && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center mb-3">
              <Home className="text-purple-500 mr-2" size={20} />
              Parent Homework
            </h3>
            <div className="text-gray-600 bg-purple-50 p-4 rounded-lg border border-purple-100">
              {session.parent_homework}
            </div>
          </div>
        )}

        {/* Navigation Footer */}
        <div className="flex items-center justify-between bg-white rounded-lg shadow p-4">
          <button
            onClick={() => navigateSession('prev')}
            disabled={!canGoPrev}
            className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={20} className="mr-1" />
            Previous Day
          </button>
          <button
            onClick={() => toggleSession(playbook, session.day)}
            className={`flex items-center space-x-2 px-6 py-2 rounded-lg font-medium transition-colors ${
              isCompleted
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isCompleted ? (
              <>
                <CheckCircle size={20} />
                <span>Completed!</span>
              </>
            ) : (
              <>
                <Circle size={20} />
                <span>Mark Day Complete</span>
              </>
            )}
          </button>
          <button
            onClick={() => navigateSession('next')}
            disabled={!canGoNext}
            className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next Day
            <ChevronRight size={20} className="ml-1" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Progression Playbooks</h2>
        <p className="text-gray-600">Step-by-step training programs to build specific skills</p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'active'
              ? 'bg-white text-gray-900 shadow'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Play size={18} />
            <span>Active ({activePlaybooks.length})</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={`px-4 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'library'
              ? 'bg-white text-gray-900 shadow'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Book size={18} />
            <span>Library ({templates.length})</span>
          </div>
        </button>
      </div>

      {/* Active Playbooks Tab */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {activePlaybooks.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <Book className="mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600 mb-4">No active playbooks</p>
              <button
                onClick={() => setActiveTab('library')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Browse Library
              </button>
            </div>
          ) : (
            activePlaybooks.map((playbook) => (
              <div key={playbook.id} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{playbook.title}</h3>
                      <div className="flex items-center space-x-3 mt-1">
                        <span className="text-sm text-gray-500">
                          {playbook.player ? `For: ${playbook.player.name}` : 'For: Whole Team'}
                        </span>
                        <span className="text-sm text-gray-500">
                          Started: {formatDate(playbook.started_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => deletePlaybook(playbook.id)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">Progress</span>
                      <span className="font-medium text-gray-900">
                        {playbook.completed_sessions?.length || 0} / {playbook.playbook_template?.total_sessions} sessions ({getProgress(playbook)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-green-500 h-3 rounded-full transition-all"
                        style={{ width: `${getProgress(playbook)}%` }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedPlaybook(expandedPlaybook === playbook.id ? null : playbook.id)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center"
                  >
                    {expandedPlaybook === playbook.id ? (
                      <>
                        <ChevronUp size={16} className="mr-1" />
                        Hide Sessions
                      </>
                    ) : (
                      <>
                        <ChevronDown size={16} className="mr-1" />
                        View Sessions
                      </>
                    )}
                  </button>
                </div>

                {/* Expanded Sessions */}
                {expandedPlaybook === playbook.id && playbook.playbook_template?.sessions && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50 max-h-[500px] overflow-y-auto">
                    <div className="space-y-2">
                      {playbook.playbook_template.sessions.sessions.map((session: SessionDetail, idx: number) => {
                        const isCompleted = playbook.completed_sessions?.includes(session.day)
                        return (
                          <div 
                            key={session.day}
                            className={`flex items-start space-x-3 p-3 rounded-lg transition-colors ${
                              isCompleted ? 'bg-green-50' : 'bg-white hover:bg-blue-50'
                            }`}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleSession(playbook, session.day)
                              }}
                              className="flex-shrink-0 mt-0.5"
                            >
                              {isCompleted ? (
                                <CheckCircle className="text-green-500" size={22} />
                              ) : (
                                <Circle className="text-gray-300 hover:text-gray-400" size={22} />
                              )}
                            </button>
                            <div 
                              className="flex-1 min-w-0 cursor-pointer"
                              onClick={() => openSessionDetail(playbook, session, idx)}
                            >
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-medium text-gray-500">Day {session.day}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${getPhaseColor(session.phase)}`}>
                                  {session.phase}
                                </span>
                              </div>
                              <p className={`font-medium ${isCompleted ? 'text-green-700' : 'text-gray-900'}`}>
                                {session.title}
                              </p>
                              <p className="text-sm text-gray-500 mt-1">
                                {session.goal}
                              </p>
                              <div className="flex items-center space-x-3 mt-2 text-xs text-gray-500">
                                <span className="flex items-center">
                                  <Clock size={12} className="mr-1" />
                                  {session.duration_minutes} min
                                </span>
                                <span className="text-blue-600 font-medium">
                                  Click to view drills →
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Library Tab */}
      {activeTab === 'library' && (
        <div className="space-y-4">
          {templates.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <Book className="mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600">No playbooks available yet</p>
            </div>
          ) : (
            templates.map((template) => (
              <div key={template.id} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{template.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${getCategoryColor(template.skill_category)}`}>
                          {template.skill_category}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{template.description}</p>
                    </div>
                    <button
                      onClick={() => openAssignModal(template)}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      <Plus size={16} />
                      <span>Start</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
                    <span className="flex items-center text-gray-500">
                      <Target size={14} className="mr-1" />
                      {template.age_group}
                    </span>
                    <span className="flex items-center text-gray-500">
                      <Clock size={14} className="mr-1" />
                      {template.total_sessions} sessions
                    </span>
                    <span className="flex items-center text-gray-500">
                      <RotateCcw size={14} className="mr-1" />
                      {template.sessions_per_week}x/week recommended
                    </span>
                  </div>

                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <div className="text-sm font-medium text-blue-900">Goal:</div>
                    <div className="text-sm text-blue-700">{template.goal}</div>
                  </div>

                  <button
                    onClick={() => setExpandedTemplate(expandedTemplate === template.id ? null : template.id)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center mt-3"
                  >
                    {expandedTemplate === template.id ? (
                      <>
                        <ChevronUp size={16} className="mr-1" />
                        Hide Details
                      </>
                    ) : (
                      <>
                        <ChevronDown size={16} className="mr-1" />
                        Preview Sessions
                      </>
                    )}
                  </button>
                </div>

                {/* Expanded Preview */}
                {expandedTemplate === template.id && template.sessions && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50">
                    {template.sessions.coaching_philosophy && (
                      <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <div className="text-sm font-medium text-yellow-800">Coaching Philosophy:</div>
                        <div className="text-sm text-yellow-700 mt-1">{template.sessions.coaching_philosophy}</div>
                      </div>
                    )}

                    {template.equipment && template.equipment.length > 0 && (
                      <div className="mb-4">
                        <div className="text-sm font-medium text-gray-700 mb-1">Equipment Needed:</div>
                        <div className="flex flex-wrap gap-2">
                          {template.equipment.map((item, idx) => (
                            <span key={idx} className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-sm font-medium text-gray-700 mb-2">Session Overview:</div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {template.sessions.sessions?.slice(0, 10).map((session: any) => (
                        <div key={session.day} className="flex items-center space-x-3 p-2 bg-white rounded border border-gray-200">
                          <span className="text-xs font-medium text-gray-500 w-12">Day {session.day}</span>
                          <span className="text-sm text-gray-900 flex-1">{session.title}</span>
                          <span className="text-xs text-gray-500">{session.duration_minutes} min</span>
                        </div>
                      ))}
                      {template.sessions.sessions?.length > 10 && (
                        <div className="text-sm text-gray-500 text-center py-2">
                          + {template.sessions.sessions.length - 10} more sessions
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Assign Modal */}
      {showAssignModal && selectedTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Start Playbook</h3>
            <p className="text-gray-600 mb-4">{selectedTemplate.title}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assign To
                </label>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setAssignTo('team')}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 transition-colors ${
                      assignTo === 'team'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Users size={20} className="mx-auto mb-1" />
                    <div className="text-sm">Whole Team</div>
                  </button>
                  <button
                    onClick={() => setAssignTo('player')}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 transition-colors ${
                      assignTo === 'player'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Target size={20} className="mx-auto mb-1" />
                    <div className="text-sm">Specific Player</div>
                  </button>
                </div>
              </div>

              {assignTo === 'player' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Player
                  </label>
                  <select
                    value={selectedPlayerId}
                    onChange={(e) => setSelectedPlayerId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Choose a player...</option>
                    {players.map((tp) => (
                      <option key={tp.player.id} value={tp.player.id}>
                        {tp.player.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={assigning || (assignTo === 'player' && !selectedPlayerId)}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {assigning ? 'Starting...' : 'Start Playbook'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PlaybooksPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <PlaybooksPageContent />
    </Suspense>
  )
}
