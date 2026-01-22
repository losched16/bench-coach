'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

type Step = 'choice' | 'season' | 'team' | 'players' | 'personal' | 'complete'
type Mode = 'full' | 'personal' | 'skip'

const AGE_GROUPS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U+']
const SKILL_LEVELS = ['beginner', 'mixed', 'advanced']
const LEAGUE_TYPES = ['rec', 'travel', 'clinic', 'other']
const PRACTICE_DURATIONS = [60, 75, 90, 120]

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>('choice')
  const [mode, setMode] = useState<Mode>('full')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClientComponentClient()

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

  // Players data
  const [players, setPlayers] = useState<Array<{ name: string; jersey: string }>>([
    { name: '', jersey: '' }
  ])

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

  const handleSkipOnboarding = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!coach) throw new Error('Coach profile not found')

      // Create minimal "Personal Training" setup
      const { data: season } = await supabase
        .from('seasons')
        .insert({
          coach_id: coach.id,
          name: 'Personal Training',
          league_type: 'other',
        })
        .select()
        .single()

      await supabase
        .from('teams')
        .insert({
          season_id: season.id,
          coach_id: coach.id,
          name: 'My Training',
          age_group: '8U',
          skill_level: 'mixed',
          practice_duration_minutes: 60,
        })
        .select()
        .single()

      setStep('complete')
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1500)

    } catch (error: any) {
      console.error('Skip onboarding error:', error)
      alert('Failed to setup: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePersonalMode = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!coach) throw new Error('Coach profile not found')

      // Create "Personal Training" season
      const { data: season } = await supabase
        .from('seasons')
        .insert({
          coach_id: coach.id,
          name: 'Personal Training',
          league_type: 'other',
        })
        .select()
        .single()

      // Create personal team
      const { data: team } = await supabase
        .from('teams')
        .insert({
          season_id: season.id,
          coach_id: coach.id,
          name: 'My Kids',
          age_group: ageGroup,
          skill_level: skillLevel,
          practice_duration_minutes: practiceDuration,
          primary_goals: [],
        })
        .select()
        .single()

      // Add kids
      const validPlayers = players.filter(p => p.name.trim() !== '')
      
      if (validPlayers.length > 0) {
        const { data: createdPlayers } = await supabase
          .from('players')
          .insert(
            validPlayers.map(p => ({
              coach_id: coach.id,
              name: p.name,
              jersey_number: p.jersey || null,
            }))
          )
          .select()

        await supabase
          .from('team_players')
          .insert(
            createdPlayers.map(p => ({
              team_id: team.id,
              player_id: p.id,
            }))
          )
      }

      setStep('complete')
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1500)

    } catch (error: any) {
      console.error('Personal mode error:', error)
      alert('Failed to setup: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFullSetup = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!coach) throw new Error('Coach profile not found')

      // Create season
      const { data: season } = await supabase
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

      // Create team
      const { data: team } = await supabase
        .from('teams')
        .insert({
          season_id: season.id,
          coach_id: coach.id,
          name: teamName,
          age_group: ageGroup,
          skill_level: skillLevel,
          practice_duration_minutes: practiceDuration,
          primary_goals: [],
        })
        .select()
        .single()

      // Create players
      const validPlayers = players.filter(p => p.name.trim() !== '')
      
      if (validPlayers.length > 0) {
        const { data: createdPlayers } = await supabase
          .from('players')
          .insert(
            validPlayers.map(p => ({
              coach_id: coach.id,
              name: p.name,
              jersey_number: p.jersey || null,
            }))
          )
          .select()

        await supabase
          .from('team_players')
          .insert(
            createdPlayers.map(p => ({
              team_id: team.id,
              player_id: p.id,
            }))
          )
      }

      setStep('complete')
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1500)

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        
        {/* Choice Step */}
        {step === 'choice' && (
          <div className="bg-white rounded-lg shadow-xl p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Bench Coach!</h2>
              <p className="text-gray-600">How would you like to get started?</p>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => {
                  setMode('full')
                  setStep('season')
                }}
                className="w-full p-6 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
              >
                <div className="font-semibold text-lg text-gray-900 mb-1">
                  🏆 Setup a Team
                </div>
                <div className="text-sm text-gray-600">
                  I'm coaching a Little League team or travel team
                </div>
              </button>

              <button
                onClick={() => {
                  setMode('personal')
                  setStep('personal')
                }}
                className="w-full p-6 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
              >
                <div className="font-semibold text-lg text-gray-900 mb-1">
                  👨‍👦 Just My Kid(s)
                </div>
                <div className="text-sm text-gray-600">
                  I want to track progress for my own child
                </div>
              </button>

              <button
                onClick={handleSkipOnboarding}
                disabled={loading}
                className="w-full p-6 border-2 border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors text-left disabled:opacity-50"
              >
                <div className="font-semibold text-lg text-gray-900 mb-1">
                  ⏭️ Skip for Now
                </div>
                <div className="text-sm text-gray-600">
                  I'll set things up later
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Personal Mode - Just Add Kids */}
        {step === 'personal' && (
          <div className="bg-white rounded-lg shadow-xl p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Add Your Kid(s)</h2>
              <p className="text-gray-600">Track their progress and get coaching tips</p>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Age Group
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
                  Typical Practice Duration
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
                  Kids
                </label>
                <div className="space-y-3">
                  {players.map((player, index) => (
                    <div key={index} className="flex space-x-3">
                      <input
                        type="text"
                        value={player.name}
                        onChange={(e) => updatePlayer(index, 'name', e.target.value)}
                        placeholder="Child's name"
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
                  className="mt-3 w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-700 transition-colors"
                >
                  + Add Another Child
                </button>
              </div>

              <div className="flex space-x-4 pt-4">
                <button
                  onClick={() => setStep('choice')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handlePersonalMode}
                  disabled={loading || players.every(p => !p.name.trim())}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Setting up...' : 'Complete Setup'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Full Team Setup Flow (existing code) */}
        {step === 'season' && (
          <div className="bg-white rounded-lg shadow-xl p-8">
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Create Your Season</h2>
                <p className="text-gray-600">Set up your season details</p>
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

              <div className="flex space-x-4">
                <button
                  onClick={() => setStep('choice')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('team')}
                  disabled={!seasonName}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'team' && (
          <div className="bg-white rounded-lg shadow-xl p-8">
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
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'players' && (
          <div className="bg-white rounded-lg shadow-xl p-8">
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Add Players</h2>
                <p className="text-gray-600">You can add more later</p>
              </div>

              <div className="space-y-3">
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
                  onClick={handleFullSetup}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Complete Setup'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}