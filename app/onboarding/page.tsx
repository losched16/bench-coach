'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'

type Step = 'season' | 'team' | 'players' | 'complete'

const AGE_GROUPS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U+']
const SKILL_LEVELS = ['beginner', 'mixed', 'advanced']
const LEAGUE_TYPES = ['rec', 'travel', 'clinic', 'other']
const PRACTICE_DURATIONS = [60, 75, 90, 120]
const PRIMARY_GOALS = [
  'throwing',
  'catching',
  'infield',
  'outfield',
  'hitting',
  'baserunning',
  'game IQ',
  'confidence',
  'focus/behavior'
]

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>('season')
  const [loading, setLoading] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const router = useRouter()
  const supabase = createSupabaseComponentClient()

  // Check for pending invite or existing team access on mount
  useEffect(() => {
    const checkAccess = async () => {
      // First check for pending invite
      const pendingInvite = sessionStorage.getItem('pendingInviteToken')
      if (pendingInvite) {
        router.push(`/invite/${pendingInvite}`)
        return
      }

      // Check if user already has team access (as member)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }

      // Get coach profile
      const { data: coach } = await supabase
        .from('coaches')
        .select('id, is_subscribed')
        .eq('user_id', user.id)
        .single()

      // Check for team memberships
      const { data: memberships } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id)
        .limit(1)

      if (memberships && memberships.length > 0) {
        // User has team access via membership - go to dashboard with that team
        router.push(`/dashboard?teamId=${memberships[0].team_id}`)
        return
      }

      // Check if user owns teams (legacy users)
      if (coach) {
        const { data: ownedTeams } = await supabase
          .from('teams')
          .select('id')
          .eq('coach_id', coach.id)
          .limit(1)

        if (ownedTeams && ownedTeams.length > 0) {
          // Has teams, go to dashboard
          router.push('/dashboard')
          return
        }
      }

      // User has no teams - check if they can create (subscribed)
      if (!coach?.is_subscribed) {
        // Not subscribed, send to paywall
        router.push('/subscribe')
        return
      }

      // Subscribed user with no teams - allow onboarding
      setCheckingAccess(false)
    }

    checkAccess()
  }, [router, supabase])

  // Season data
  const [seasonName, setSeasonName] = useState('')
  const [leagueType, setLeagueType] = useState('rec')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Team data
  const [teamName, setTeamName] = useState('')
  const [ageGroup, setAgeGroup] = useState('8U')
  const [skillLevel, setSkillLevel] = useState('mixed')
  const [practiceDuration, setPracticeDuration] = useState(90)
  const [practiceDays, setPracticeDays] = useState<string[]>([])
  const [goals, setGoals] = useState<string[]>([])

  // Players data
  const [players, setPlayers] = useState<Array<{ name: string; jersey: string }>>([
    { name: '', jersey: '' }
  ])

  const togglePracticeDay = (day: string) => {
    setPracticeDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  const toggleGoal = (goal: string) => {
    setGoals(prev =>
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]
    )
  }

  const addPlayer = () => {
    setPlayers([...players, { name: '', jersey: '' }])
  }

  const removePlayer = (index: number) => {
    setPlayers(players.filter((_, i) => i !== index))
  }

  const updatePlayer = (index: number, field: 'name' | 'jersey', value: string) => {
    const updated = [...players]
    updated[index][field] = value
    setPlayers(updated)
  }

  const handleComplete = async () => {
    setLoading(true)

    try {
      // Get current coach
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!coach) throw new Error('Coach profile not found')

      // Create season
      const { data: season, error: seasonError } = await supabase
        .from('seasons')
        .insert({
          coach_id: coach.id,
          name: seasonName,
          league_type: leagueType,
          start_date: startDate || null,
          end_date: endDate || null,
        })
        .select()
        .single()

      if (seasonError) throw seasonError

      // Create team
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .insert({
          season_id: season.id,
          coach_id: coach.id,
          name: teamName,
          age_group: ageGroup,
          skill_level: skillLevel,
          practice_duration_minutes: practiceDuration,
          practice_days: practiceDays,
          primary_goals: goals,
        })
        .select()
        .single()

      if (teamError) throw teamError

      // Create players and link to team
      const validPlayers = players.filter(p => p.name.trim() !== '')
      
      if (validPlayers.length > 0) {
        const { data: createdPlayers, error: playersError } = await supabase
          .from('players')
          .insert(
            validPlayers.map(p => ({
              coach_id: coach.id,
              name: p.name,
              jersey_number: p.jersey || null,
            }))
          )
          .select()

        if (playersError) throw playersError

        // Link players to team
        const { error: teamPlayersError } = await supabase
          .from('team_players')
          .insert(
            createdPlayers.map(p => ({
              team_id: team.id,
              player_id: p.id,
            }))
          )

        if (teamPlayersError) throw teamPlayersError
      }

      setStep('complete')
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 2000)

    } catch (error: any) {
      console.error('Onboarding error:', error)
      alert('Failed to complete setup: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  if (step === 'complete') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="text-center">
          <div className="text-6xl mb-4">⚾</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">All set, Coach!</h1>
          <p className="text-gray-600">Taking you to your dashboard...</p>
        </div>
      </div>
    )
  }

  // Show loading while checking access
  if (checkingAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              step === 'season' ? 'bg-blue-600 text-white' : 'bg-white text-gray-400'
            }`}>1</div>
            <div className="w-16 h-1 bg-white"></div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              step === 'team' ? 'bg-blue-600 text-white' : 'bg-white text-gray-400'
            }`}>2</div>
            <div className="w-16 h-1 bg-white"></div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              step === 'players' ? 'bg-blue-600 text-white' : 'bg-white text-gray-400'
            }`}>3</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* Season Step */}
          {step === 'season' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Create Your First Season</h2>
                <p className="text-gray-600">Let's set up your season</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Season Name *
                </label>
                <input
                  type="text"
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.target.value)}
                  placeholder="Spring 2026"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  League Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {LEAGUE_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setLeagueType(type)}
                      className={`px-4 py-3 rounded-lg border-2 transition-colors capitalize ${
                        leagueType === type
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date (optional)
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Date (optional)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <button
                onClick={() => setStep('team')}
                disabled={!seasonName}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Team Setup
              </button>
            </div>
          )}

          {/* Team Step */}
          {step === 'team' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Create Your Team</h2>
                <p className="text-gray-600">Tell us about your team</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Team Name *
                </label>
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="8U Tigers"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Age Group *
                  </label>
                  <select
                    value={ageGroup}
                    onChange={(e) => setAgeGroup(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {AGE_GROUPS.map(age => (
                      <option key={age} value={age}>{age}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Skill Level
                  </label>
                  <select
                    value={skillLevel}
                    onChange={(e) => setSkillLevel(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {SKILL_LEVELS.map(level => (
                      <option key={level} value={level} className="capitalize">{level}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Practice Duration
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {PRACTICE_DURATIONS.map(duration => (
                    <button
                      key={duration}
                      type="button"
                      onClick={() => setPracticeDuration(duration)}
                      className={`px-4 py-3 rounded-lg border-2 transition-colors ${
                        practiceDuration === duration
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {duration} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Practice Days (optional)
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => togglePracticeDay(day)}
                      className={`px-4 py-3 rounded-lg border-2 transition-colors ${
                        practiceDays.includes(day)
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Primary Goals (choose up to 3)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {PRIMARY_GOALS.map(goal => (
                    <button
                      key={goal}
                      type="button"
                      onClick={() => toggleGoal(goal)}
                      disabled={!goals.includes(goal) && goals.length >= 3}
                      className={`px-4 py-3 rounded-lg border-2 transition-colors capitalize text-sm ${
                        goals.includes(goal)
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300 disabled:opacity-50'
                      }`}
                    >
                      {goal}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex space-x-4">
                <button
                  onClick={() => setStep('season')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('players')}
                  disabled={!teamName}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue to Roster
                </button>
              </div>
            </div>
          )}

          {/* Players Step */}
          {step === 'players' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Add Your Players</h2>
                <p className="text-gray-600">You can add more later</p>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {players.map((player, index) => (
                  <div key={index} className="flex space-x-3">
                    <input
                      type="text"
                      value={player.name}
                      onChange={(e) => updatePlayer(index, 'name', e.target.value)}
                      placeholder="Player name"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={player.jersey}
                      onChange={(e) => updatePlayer(index, 'jersey', e.target.value)}
                      placeholder="#"
                      className="w-20 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {players.length > 1 && (
                      <button
                        onClick={() => removePlayer(index)}
                        className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={addPlayer}
                className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-700 transition-colors"
              >
                + Add Another Player
              </button>

              <div className="flex space-x-4">
                <button
                  onClick={() => setStep('team')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Complete Setup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
