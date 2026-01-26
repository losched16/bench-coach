'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { ArrowLeft, Save, Check, Star, TrendingUp } from 'lucide-react'
import Link from 'next/link'

const PRIMARY_GOALS = [
  { id: 'throwing', label: 'Throwing', icon: '🎯' },
  { id: 'catching', label: 'Catching', icon: '🧤' },
  { id: 'infield', label: 'Infield', icon: '⚾' },
  { id: 'outfield', label: 'Outfield', icon: '🏃' },
  { id: 'hitting', label: 'Hitting', icon: '🏏' },
  { id: 'baserunning', label: 'Baserunning', icon: '👟' },
  { id: 'game IQ', label: 'Game IQ', icon: '🧠' },
  { id: 'confidence', label: 'Confidence', icon: '💪' },
  { id: 'focus/behavior', label: 'Focus/Behavior', icon: '🎯' },
]

const SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner', description: 'New to baseball' },
  { value: 'mixed', label: 'Mixed', description: 'Variety of skill levels' },
  { value: 'advanced', label: 'Advanced', description: 'Experienced players' },
]

const PRACTICE_DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 75, label: '1 hr 15 min' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
]

interface TeamData {
  id: string
  name: string
  age_group: string
  skill_level: string
  practice_duration_minutes: number
  primary_goals: string[]
  improved_areas: string[]
  mastered_areas: string[]
}

export default function SettingsPage() {
  const [team, setTeam] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  
  // Editable fields
  const [teamName, setTeamName] = useState('')
  const [skillLevel, setSkillLevel] = useState('')
  const [practiceDuration, setPracticeDuration] = useState(60)
  const [goals, setGoals] = useState<string[]>([])
  const [improvedAreas, setImprovedAreas] = useState<string[]>([])
  const [masteredAreas, setMasteredAreas] = useState<string[]>([])
  
  const searchParams = useSearchParams()
  const router = useRouter()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadTeam()
    }
  }, [teamId])

  const loadTeam = async () => {
    try {
      const { data } = await supabase
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single()

      if (data) {
        setTeam(data)
        setTeamName(data.name)
        setSkillLevel(data.skill_level || 'mixed')
        setPracticeDuration(data.practice_duration_minutes || 60)
        setGoals(data.primary_goals || [])
        setImprovedAreas(data.improved_areas || [])
        setMasteredAreas(data.mastered_areas || [])
      }
    } catch (error) {
      console.error('Error loading team:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleGoal = (goalId: string) => {
    // If it's mastered or improved, don't allow toggling as a goal
    if (masteredAreas.includes(goalId)) return
    
    setGoals(prev =>
      prev.includes(goalId) ? prev.filter(g => g !== goalId) : [...prev, goalId]
    )
  }

  const markAsImproved = (goalId: string) => {
    if (masteredAreas.includes(goalId)) return
    
    setImprovedAreas(prev =>
      prev.includes(goalId) ? prev.filter(g => g !== goalId) : [...prev, goalId]
    )
  }

  const markAsMastered = (goalId: string) => {
    setMasteredAreas(prev => {
      if (prev.includes(goalId)) {
        return prev.filter(g => g !== goalId)
      } else {
        // Remove from improved if marking as mastered
        setImprovedAreas(imp => imp.filter(g => g !== goalId))
        // Remove from active goals
        setGoals(g => g.filter(goal => goal !== goalId))
        return [...prev, goalId]
      }
    })
  }

  const handleSave = async () => {
    if (!teamId) return
    
    setSaving(true)
    setSaved(false)

    try {
      const { error } = await supabase
        .from('teams')
        .update({
          name: teamName,
          skill_level: skillLevel,
          practice_duration_minutes: practiceDuration,
          primary_goals: goals,
          improved_areas: improvedAreas,
          mastered_areas: masteredAreas,
        })
        .eq('id', teamId)

      if (error) throw error

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      
      // Refresh the page to update header
      router.refresh()
    } catch (error) {
      console.error('Error saving:', error)
      alert('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading settings...</div>
  }

  if (!team) {
    return <div className="text-gray-600">Team not found</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link 
            href={`/dashboard?teamId=${teamId}`}
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft size={20} className="mr-2" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Team Settings</h1>
          <p className="text-gray-600">Update your team's focus areas and settings</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center space-x-2 px-6 py-3 rounded-lg transition-colors ${
            saved 
              ? 'bg-green-600 text-white' 
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          {saved ? <Check size={20} /> : <Save size={20} />}
          <span>{saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}</span>
        </button>
      </div>

      {/* Team Name */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Info</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Team Name
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Age Group
            </label>
            <div className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
              {team.age_group}
            </div>
          </div>
        </div>
      </div>

      {/* Practice Settings */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Practice Settings</h2>
        
        <div className="space-y-6">
          {/* Skill Level */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Team Skill Level
            </label>
            <div className="grid grid-cols-3 gap-3">
              {SKILL_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setSkillLevel(level.value)}
                  className={`p-4 rounded-lg border text-left transition-colors ${
                    skillLevel === level.value
                      ? 'bg-blue-50 border-blue-600 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium">{level.label}</div>
                  <div className="text-xs text-gray-500">{level.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Practice Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Practice Duration
            </label>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {PRACTICE_DURATIONS.map((duration) => (
                <button
                  key={duration.value}
                  type="button"
                  onClick={() => setPracticeDuration(duration.value)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    practiceDuration === duration.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {duration.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Focus Areas */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Focus Areas</h2>
        <p className="text-sm text-gray-600 mb-4">
          Select areas to work on. Mark them as improved or mastered as your team progresses.
        </p>
        
        <div className="space-y-3">
          {PRIMARY_GOALS.map((goal) => {
            const isActive = goals.includes(goal.id)
            const isImproved = improvedAreas.includes(goal.id)
            const isMastered = masteredAreas.includes(goal.id)
            
            return (
              <div
                key={goal.id}
                className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                  isMastered 
                    ? 'bg-green-50 border-green-300' 
                    : isImproved 
                      ? 'bg-yellow-50 border-yellow-300'
                      : isActive 
                        ? 'bg-blue-50 border-blue-300' 
                        : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{goal.icon}</span>
                  <div>
                    <div className="font-medium text-gray-900">{goal.label}</div>
                    {isMastered && (
                      <span className="text-xs text-green-600 font-medium">✓ Mastered</span>
                    )}
                    {isImproved && !isMastered && (
                      <span className="text-xs text-yellow-600 font-medium">↗ Improved</span>
                    )}
                    {isActive && !isImproved && !isMastered && (
                      <span className="text-xs text-blue-600 font-medium">Currently working on</span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {!isMastered && (
                    <>
                      <button
                        onClick={() => toggleGoal(goal.id)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                        }`}
                      >
                        {isActive ? 'Active' : 'Add'}
                      </button>
                      {isActive && (
                        <button
                          onClick={() => markAsImproved(goal.id)}
                          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                            isImproved
                              ? 'bg-yellow-500 text-white'
                              : 'bg-gray-200 text-gray-600 hover:bg-yellow-100'
                          }`}
                          title="Mark as improved"
                        >
                          <TrendingUp size={14} />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => markAsMastered(goal.id)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      isMastered
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-600 hover:bg-green-100'
                    }`}
                    title="Mark as mastered"
                  >
                    <Star size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        
        {/* Legend */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="text-sm text-gray-600 flex flex-wrap gap-4">
            <span className="flex items-center">
              <span className="w-3 h-3 bg-blue-500 rounded mr-2"></span>
              Active - Currently working on
            </span>
            <span className="flex items-center">
              <span className="w-3 h-3 bg-yellow-500 rounded mr-2"></span>
              Improved - Getting better
            </span>
            <span className="flex items-center">
              <span className="w-3 h-3 bg-green-500 rounded mr-2"></span>
              Mastered - Solid skills
            </span>
          </div>
        </div>
      </div>

      {/* Progress Summary */}
      {(improvedAreas.length > 0 || masteredAreas.length > 0) && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Season Progress</h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-sm text-gray-600 mb-2">Improved</div>
              <div className="text-3xl font-bold text-yellow-600">{improvedAreas.length}</div>
              <div className="text-sm text-gray-500">areas showing growth</div>
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-2">Mastered</div>
              <div className="text-3xl font-bold text-green-600">{masteredAreas.length}</div>
              <div className="text-sm text-gray-500">solid skills</div>
            </div>
          </div>
        </div>
      )}

      {/* Save Button (bottom) */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center space-x-2 px-8 py-3 rounded-lg transition-colors ${
            saved 
              ? 'bg-green-600 text-white' 
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          {saved ? <Check size={20} /> : <Save size={20} />}
          <span>{saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}</span>
        </button>
      </div>
    </div>
  )
}
