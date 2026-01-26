'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const AGE_GROUPS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U+']
const SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner - New to baseball' },
  { value: 'mixed', label: 'Mixed - Variety of skill levels' },
  { value: 'advanced', label: 'Advanced - Experienced players' },
]

export default function NewTeamPage() {
  const [seasonName, setSeasonName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [skillLevel, setSkillLevel] = useState('')
  const [practiceDuration, setPracticeDuration] = useState('60')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createSupabaseComponentClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Get coach profile
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
          practice_duration_minutes: parseInt(practiceDuration),
        })
        .select()
        .single()

      if (teamError) throw teamError

      // Redirect to dashboard with new team
      router.push(`/dashboard?teamId=${team.id}`)
      router.refresh()
    } catch (error: any) {
      setError(error.message || 'Failed to create team')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link 
          href="/dashboard" 
          className="inline-flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} className="mr-2" />
          Back to Dashboard
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Team</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Season Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Season Name *
            </label>
            <input
              type="text"
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              placeholder="e.g., Spring 2026"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Team Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Team Name *
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g., Tigers"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Age Group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Age Group *
            </label>
            <div className="grid grid-cols-4 gap-2">
              {AGE_GROUPS.map((age) => (
                <button
                  key={age}
                  type="button"
                  onClick={() => setAgeGroup(age)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    ageGroup === age
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          {/* Skill Level */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Skill Level *
            </label>
            <div className="space-y-2">
              {SKILL_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setSkillLevel(level.value)}
                  className={`w-full px-4 py-3 rounded-lg border text-left transition-colors ${
                    skillLevel === level.value
                      ? 'bg-blue-50 border-blue-600 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {/* Practice Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Typical Practice Duration (minutes)
            </label>
            <select
              value={practiceDuration}
              onChange={(e) => setPracticeDuration(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
              <option value="75">75 minutes</option>
              <option value="90">90 minutes</option>
              <option value="120">2 hours</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex space-x-4">
            <Link
              href="/dashboard"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-center text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !seasonName || !teamName || !ageGroup || !skillLevel}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
