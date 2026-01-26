'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { ArrowLeft, User } from 'lucide-react'
import Link from 'next/link'

export default function NewPlayerPage() {
  const [playerName, setPlayerName] = useState('')
  const [jerseyNumber, setJerseyNumber] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createSupabaseComponentClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!playerName.trim()) {
      setError('Please enter a player name')
      return
    }

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

      // Check if "Personal" season exists, create if not
      let personalSeason = null
      const { data: existingSeasons } = await supabase
        .from('seasons')
        .select('id')
        .eq('coach_id', coach.id)
        .eq('name', 'Personal')
        .limit(1)

      if (existingSeasons && existingSeasons.length > 0) {
        personalSeason = existingSeasons[0]
      } else {
        // Create a "Personal" season
        const { data: newSeason, error: seasonError } = await supabase
          .from('seasons')
          .insert({
            coach_id: coach.id,
            name: 'Personal',
            league_type: 'other',
          })
          .select()
          .single()

        if (seasonError) throw seasonError
        personalSeason = newSeason
      }

      // Create a team named after this child
      const { data: newTeam, error: teamError } = await supabase
        .from('teams')
        .insert({
          season_id: personalSeason.id,
          coach_id: coach.id,
          name: playerName,  // Team named after the child
          age_group: birthYear ? `${new Date().getFullYear() - parseInt(birthYear)}U` : 'Mixed',
          skill_level: 'mixed',
          practice_duration_minutes: 60,
        })
        .select()
        .single()

      if (teamError) throw teamError

      // Create the player
      const { data: player, error: playerError } = await supabase
        .from('players')
        .insert({
          coach_id: coach.id,
          name: playerName,
          jersey_number: jerseyNumber || null,
          birth_year: birthYear ? parseInt(birthYear) : null,
        })
        .select()
        .single()

      if (playerError) throw playerError

      // Link player to their personal team
      const { error: linkError } = await supabase
        .from('team_players')
        .insert({
          team_id: newTeam.id,
          player_id: player.id,
        })

      if (linkError) throw linkError

      // Redirect to the new personal team's roster
      router.push(`/dashboard/roster?teamId=${newTeam.id}`)
      router.refresh()
    } catch (error: any) {
      console.error('Error:', error)
      setError(error.message || 'Failed to add player')
    } finally {
      setLoading(false)
    }
  }

  // Generate year options (last 15 years)
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 15 }, (_, i) => currentYear - i)

  return (
    <div className="max-w-lg mx-auto">
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
        <div className="flex items-center space-x-4 mb-6">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
            <User size={24} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Add New Player</h1>
            <p className="text-gray-600">For personal training & coaching</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Player Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Player Name *
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="e.g., Tommy Smith"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Jersey Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jersey Number <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={jerseyNumber}
              onChange={(e) => setJerseyNumber(e.target.value)}
              placeholder="e.g., 12"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Birth Year */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Birth Year <span className="text-gray-400">(optional)</span>
            </label>
            <select
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select year...</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
            <strong>Note:</strong> This will create a personal profile for {playerName || 'this player'} that you can select from the dropdown to track their progress individually.
          </div>

          <div className="flex space-x-4">
            <Link
              href="/dashboard"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-center text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !playerName.trim()}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add Player'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
