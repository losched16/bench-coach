'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { ArrowLeft, Save, Check, Star, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { usePageView } from '@/lib/tracking'
import { useRole } from '@/lib/useRole'

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
  usePageView('settings')
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

  // Player report branding. Per COACH, not per team — it is the letterhead on
  // every report this person sends — and owner-only, so the card only renders
  // for the owner and the route refuses everyone else regardless.
  const { role } = useRole(teamId)
  const [coachId, setCoachId] = useState<string | null>(null)
  const [brandName, setBrandName] = useState('')
  const [headerLine, setHeaderLine] = useState('')
  const [footerText, setFooterText] = useState('')
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [brandingSaved, setBrandingSaved] = useState(false)
  const [brandingNotice, setBrandingNotice] = useState<string | null>(null)

  useEffect(() => {
    if (teamId) {
      loadTeam()
    }
  }, [teamId])

  // The caller's own coach row, then whatever letterhead they have saved.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const { data: coach } = await supabase
        .from('coaches').select('id').eq('user_id', user.id).maybeSingle()
      const id = (coach as any)?.id as string | undefined
      if (cancelled || !id) return
      setCoachId(id)
      try {
        const res = await fetch(`/api/player-reports/branding?coachId=${id}`)
        const data = await res.json()
        if (cancelled) return
        setBrandName(data?.branding?.brand_name || '')
        setHeaderLine(data?.branding?.header_line || '')
        setFooterText(data?.branding?.footer_text || '')
        if (data?.needsMigration) setBrandingNotice(data.migrationMessage || null)
      } catch { /* the defaults stand */ }
    })()
    return () => { cancelled = true }
  }, [])

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

  const saveBranding = async () => {
    if (!coachId) return
    setBrandingSaving(true)
    setBrandingNotice(null)
    try {
      const res = await fetch('/api/player-reports/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, brandName, headerLine, footerText }),
      })
      const data = await res.json()
      if (!res.ok) { setBrandingNotice(data?.error || 'Could not save the branding.'); return }
      setBrandingSaved(true)
      setTimeout(() => setBrandingSaved(false), 2000)
    } catch {
      setBrandingNotice('Could not save the branding — check your connection.')
    } finally {
      setBrandingSaving(false)
    }
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

      {/* Player report branding — the coach's letterhead, not the team's */}
      {role === 'owner' && (
        <div id="report-branding" className="bg-white rounded-lg shadow p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Player Report Branding</h2>
              <p className="text-sm text-gray-500 mt-1">
                What the top and bottom of every report you send say. Applies to all your
                teams. Reports you have already finalized keep the branding they went out with.
              </p>
            </div>
            <button
              onClick={saveBranding}
              disabled={brandingSaving || !coachId}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg transition-colors ${
                brandingSaved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {brandingSaved ? <Check size={18} /> : <Save size={18} />}
              <span>{brandingSaving ? 'Saving...' : brandingSaved ? 'Saved!' : 'Save Branding'}</span>
            </button>
          </div>

          {brandingNotice && (
            <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {brandingNotice}
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="brand-name" className="block text-sm font-medium text-gray-700 mb-2">
                Name at the top
              </label>
              <input
                id="brand-name"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                maxLength={60}
                placeholder="BenchCoach"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">Your league or team name, for example. Leave blank for BenchCoach.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {teamName && (
                  <button
                    type="button"
                    onClick={() => setBrandName(teamName)}
                    className="text-xs px-2.5 py-1 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Use team name
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBrandName('')}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Use BenchCoach
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="brand-header" className="block text-sm font-medium text-gray-700 mb-2">
                Line beside it
              </label>
              <input
                id="brand-header"
                type="text"
                value={headerLine}
                onChange={(e) => setHeaderLine(e.target.value)}
                maxLength={60}
                placeholder="Player Development Report"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="brand-footer" className="block text-sm font-medium text-gray-700 mb-2">
                Footer
              </label>
              <input
                id="brand-footer"
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                maxLength={140}
                placeholder="Player Development Report powered by BenchCoach"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* The same header and footer the report renders, live. */}
          <div className="mt-5 rounded-lg border border-gray-200 overflow-hidden" aria-label="Preview of the report letterhead">
            <div className="px-4 pt-3 pb-2 border-b-2 border-red-600 flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-[11px] font-bold tracking-widest text-red-600 uppercase">{brandName || 'BenchCoach'}</span>
              <span className="text-[10px] tracking-wider text-gray-400 uppercase">{headerLine || 'Player Development Report'}</span>
            </div>
            <div className="px-4 py-4 text-xs text-gray-300 italic">The report goes here.</div>
            <div className="px-4 py-2 border-t border-gray-200 text-[11px] text-gray-400">
              {footerText || 'Player Development Report powered by BenchCoach'}
            </div>
          </div>
        </div>
      )}

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
