'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Search, Filter, Play, Clock, Users, MapPin, ChevronDown, ChevronUp, X } from 'lucide-react'

interface DrillResource {
  id: string
  drill_name: string
  description: string
  youtube_url: string
  youtube_video_id: string
  thumbnail_url: string
  channel: string
  skill_category: string
  primary_skill: string
  secondary_skill: string
  tags: string[]
  age_range: string
  min_age: number
  max_age: number
  difficulty_level: string
  progression_level: number
  indoor_outdoor: string
  space_required: string
  requires_partner: boolean
  equipment_needed: string[]
  mechanic_focus: string[]
  common_flaws_fixed: string[]
  safety_notes: string
  ai_coaching_notes: string
}

const SKILL_CATEGORIES = [
  'All',
  'Hitting',
  'Soft Toss',
  'Bunting',
  'Pitching',
  'Throwing',
  'Fielding (Infield)',
  'Fielding (Fly Balls)',
  'Catching',
  'Baserunning',
]

const DIFFICULTY_LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced']

const AGE_GROUPS = ['All', '6U', '8U', '10U', '12U']

export default function DrillLibraryPage() {
  const [drills, setDrills] = useState<DrillResource[]>([])
  const [filteredDrills, setFilteredDrills] = useState<DrillResource[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedDifficulty, setSelectedDifficulty] = useState('All')
  const [selectedAge, setSelectedAge] = useState('All')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedDrill, setSelectedDrill] = useState<DrillResource | null>(null)
  
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    loadDrills()
  }, [])

  useEffect(() => {
    filterDrills()
  }, [drills, searchQuery, selectedCategory, selectedDifficulty, selectedAge])

  const loadDrills = async () => {
    try {
      const { data, error } = await supabase
        .from('drill_resources')
        .select('*')
        .order('skill_category')
        .order('progression_level')

      if (error) throw error
      setDrills(data || [])
    } catch (error) {
      console.error('Error loading drills:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterDrills = () => {
    let filtered = [...drills]

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(d =>
        d.drill_name?.toLowerCase().includes(query) ||
        d.description?.toLowerCase().includes(query) ||
        d.tags?.some(t => t.toLowerCase().includes(query)) ||
        d.common_flaws_fixed?.some(f => f.toLowerCase().includes(query)) ||
        d.mechanic_focus?.some(m => m.toLowerCase().includes(query))
      )
    }

    // Category filter
    if (selectedCategory !== 'All') {
      filtered = filtered.filter(d => d.skill_category === selectedCategory)
    }

    // Difficulty filter
    if (selectedDifficulty !== 'All') {
      filtered = filtered.filter(d => d.difficulty_level === selectedDifficulty)
    }

    // Age filter
    if (selectedAge !== 'All') {
      const ageNum = parseInt(selectedAge.replace('U', ''))
      filtered = filtered.filter(d => {
        if (!d.min_age || !d.max_age) return true
        return d.min_age <= ageNum && d.max_age >= ageNum
      })
    }

    setFilteredDrills(filtered)
  }

  const getSkillColor = (skill: string) => {
    const colors: Record<string, string> = {
      'Hitting': 'bg-red-100 text-red-700 border-red-200',
      'Soft Toss': 'bg-red-50 text-red-600 border-red-100',
      'Bunting': 'bg-orange-100 text-orange-700 border-orange-200',
      'Pitching': 'bg-purple-100 text-purple-700 border-purple-200',
      'Throwing': 'bg-blue-100 text-blue-700 border-blue-200',
      'Fielding (Infield)': 'bg-green-100 text-green-700 border-green-200',
      'Fielding (Fly Balls)': 'bg-emerald-100 text-emerald-700 border-emerald-200',
      'Catching': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'Baserunning': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    }
    return colors[skill] || 'bg-gray-100 text-gray-700 border-gray-200'
  }

  const getDifficultyColor = (diff: string) => {
    const colors: Record<string, string> = {
      'Beginner': 'bg-green-50 text-green-600',
      'Intermediate': 'bg-yellow-50 text-yellow-600',
      'Advanced': 'bg-red-50 text-red-600',
    }
    return colors[diff] || 'bg-gray-50 text-gray-600'
  }

  const getCategoryStats = () => {
    const stats: Record<string, number> = {}
    drills.forEach(d => {
      stats[d.skill_category] = (stats[d.skill_category] || 0) + 1
    })
    return stats
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading drill library...</div>
      </div>
    )
  }

  const stats = getCategoryStats()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drill Library</h1>
          <p className="text-gray-600">{drills.length} drills with video demonstrations</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search drills, problems, or skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filter Toggle (Mobile) */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="md:hidden flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg"
          >
            <Filter size={18} />
            Filters
            {showFilters ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {/* Desktop Filters */}
          <div className="hidden md:flex gap-3">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {SKILL_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              value={selectedDifficulty}
              onChange={(e) => setSelectedDifficulty(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {DIFFICULTY_LEVELS.map(diff => (
                <option key={diff} value={diff}>{diff}</option>
              ))}
            </select>
            <select
              value={selectedAge}
              onChange={(e) => setSelectedAge(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {AGE_GROUPS.map(age => (
                <option key={age} value={age}>{age}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Mobile Filters */}
        {showFilters && (
          <div className="md:hidden mt-4 pt-4 border-t border-gray-200 grid grid-cols-3 gap-3">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {SKILL_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              value={selectedDifficulty}
              onChange={(e) => setSelectedDifficulty(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {DIFFICULTY_LEVELS.map(diff => (
                <option key={diff} value={diff}>{diff}</option>
              ))}
            </select>
            <select
              value={selectedAge}
              onChange={(e) => setSelectedAge(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {AGE_GROUPS.map(age => (
                <option key={age} value={age}>{age}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="text-sm text-gray-600">
        Showing {filteredDrills.length} of {drills.length} drills
      </div>

      {/* Drill Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDrills.map((drill) => (
          <div
            key={drill.id}
            onClick={() => setSelectedDrill(drill)}
            className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
          >
            {/* Thumbnail */}
            <div className="relative aspect-video bg-gray-100">
              {drill.thumbnail_url ? (
                <img
                  src={drill.thumbnail_url}
                  alt={drill.drill_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-200">
                  <Play className="text-gray-400" size={48} />
                </div>
              )}
              <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all flex items-center justify-center">
                <div className="opacity-0 hover:opacity-100 transition-opacity">
                  <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center">
                    <Play className="text-white ml-1" size={32} fill="white" />
                  </div>
                </div>
              </div>
              {/* Channel Badge */}
              {drill.channel && (
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-black bg-opacity-70 rounded text-xs text-white">
                  {drill.channel}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getSkillColor(drill.skill_category)}`}>
                  {drill.skill_category}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getDifficultyColor(drill.difficulty_level)}`}>
                  {drill.difficulty_level}
                </span>
              </div>

              <h3 className="font-semibold text-gray-900 mb-1 line-clamp-1">{drill.drill_name}</h3>
              <p className="text-sm text-gray-600 line-clamp-2 mb-3">{drill.description}</p>

              {/* Meta */}
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {drill.age_range && (
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {drill.age_range}
                  </span>
                )}
                {drill.indoor_outdoor && (
                  <span className="flex items-center gap-1">
                    <MapPin size={14} />
                    {drill.indoor_outdoor}
                  </span>
                )}
              </div>

              {/* Fixes */}
              {drill.common_flaws_fixed && drill.common_flaws_fixed.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Fixes:</div>
                  <div className="flex flex-wrap gap-1">
                    {drill.common_flaws_fixed.slice(0, 2).map((flaw, i) => (
                      <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs">
                        {flaw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredDrills.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No drills found matching your criteria.</p>
          <button
            onClick={() => {
              setSearchQuery('')
              setSelectedCategory('All')
              setSelectedDifficulty('All')
              setSelectedAge('All')
            }}
            className="mt-2 text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Drill Detail Modal with Embedded Video */}
      {selectedDrill && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Close Button */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded text-sm font-medium border ${getSkillColor(selectedDrill.skill_category)}`}>
                  {selectedDrill.skill_category}
                </span>
                <span className={`px-2 py-0.5 rounded text-sm font-medium ${getDifficultyColor(selectedDrill.difficulty_level)}`}>
                  {selectedDrill.difficulty_level}
                </span>
              </div>
              <button
                onClick={() => setSelectedDrill(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Embedded YouTube Video */}
            {selectedDrill.youtube_video_id && (
              <div className="aspect-video bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${selectedDrill.youtube_video_id}?rel=0`}
                  title={selectedDrill.drill_name}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {/* Content */}
            <div className="p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedDrill.drill_name}</h2>
              
              {/* Source Attribution */}
              {selectedDrill.channel && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-gray-500">Video by:</span>
                  <span className="text-sm font-medium text-gray-700">
                    {selectedDrill.channel}
                  </span>
                </div>
              )}

              <p className="text-gray-700 mb-6">{selectedDrill.description}</p>

              {/* Details Grid */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                {/* Left Column */}
                <div className="space-y-4">
                  {/* Age & Difficulty */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Who It's For</h4>
                    <div className="flex gap-2">
                      {selectedDrill.age_range && (
                        <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                          Ages {selectedDrill.age_range}
                        </span>
                      )}
                      <span className={`px-3 py-1 rounded-full text-sm ${getDifficultyColor(selectedDrill.difficulty_level)}`}>
                        {selectedDrill.difficulty_level}
                      </span>
                    </div>
                  </div>

                  {/* Equipment */}
                  {selectedDrill.equipment_needed && selectedDrill.equipment_needed.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Equipment Needed</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedDrill.equipment_needed.map((eq, i) => (
                          <span key={i} className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                            {eq}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Location */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Setting</h4>
                    <div className="flex gap-2">
                      {selectedDrill.indoor_outdoor && (
                        <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                          {selectedDrill.indoor_outdoor}
                        </span>
                      )}
                      {selectedDrill.space_required && (
                        <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                          {selectedDrill.space_required} space
                        </span>
                      )}
                      {selectedDrill.requires_partner && (
                        <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                          Requires partner
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                  {/* Fixes */}
                  {selectedDrill.common_flaws_fixed && selectedDrill.common_flaws_fixed.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Problems This Fixes</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedDrill.common_flaws_fixed.map((flaw, i) => (
                          <span key={i} className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-sm">
                            {flaw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Focus Areas */}
                  {selectedDrill.mechanic_focus && selectedDrill.mechanic_focus.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Mechanics Focus</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedDrill.mechanic_focus.map((focus, i) => (
                          <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                            {focus}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Coaching Notes */}
              {selectedDrill.ai_coaching_notes && (
                <div className="bg-blue-50 rounded-lg p-4 mb-6">
                  <h4 className="text-sm font-medium text-blue-800 mb-2">💡 Coaching Cues</h4>
                  <p className="text-blue-700 text-sm">{selectedDrill.ai_coaching_notes}</p>
                </div>
              )}

              {/* Safety Notes */}
              {selectedDrill.safety_notes && (
                <div className="bg-red-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-800 mb-2">⚠️ Safety Notes</h4>
                  <p className="text-red-700 text-sm">{selectedDrill.safety_notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
