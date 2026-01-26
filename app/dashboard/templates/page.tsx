'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { FileText, Clock, Users, Filter, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

interface PracticeTemplate {
  id: string
  title: string
  description: string
  age_group: string
  duration_minutes: number
  focus_type: string
  skill_level: string
  content: any
  tags: string[]
}

const AGE_GROUPS = [
  { value: 'all', label: 'All Ages' },
  { value: '6U', label: '6U' },
  { value: '8U', label: '8U' },
  { value: '10U', label: '10U' },
  { value: '12U', label: '12U' },
]

const FOCUS_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'balanced', label: 'Balanced Practice' },
  { value: 'first-practice', label: 'First Practice' },
  { value: 'game-warmup', label: 'Game Day Warm-up' },
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<PracticeTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAge, setSelectedAge] = useState('all')
  const [selectedFocus, setSelectedFocus] = useState('all')
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null)
  const [copying, setCopying] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  
  const searchParams = useSearchParams()
  const router = useRouter()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    loadTemplates()
  }, [])

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('practice_templates')
        .select('*')
        .order('age_group')
        .order('focus_type')

      if (error) throw error
      if (data) {
        setTemplates(data)
      }
    } catch (error) {
      console.error('Error loading templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const copyToMyPlans = async (template: PracticeTemplate) => {
    if (!teamId) {
      alert('Please select a team first')
      return
    }

    setCopying(template.id)
    try {
      const { error } = await supabase
        .from('practice_plans')
        .insert({
          team_id: teamId,
          title: template.title,
          content: template.content,
          duration_minutes: template.duration_minutes,
          focus_areas: [template.focus_type],
        })

      if (error) throw error

      setCopied(template.id)
      setTimeout(() => setCopied(null), 3000)
    } catch (error) {
      console.error('Error copying template:', error)
      alert('Failed to copy template')
    } finally {
      setCopying(null)
    }
  }

  // Filter templates
  const filteredTemplates = templates.filter(t => {
    const matchesAge = selectedAge === 'all' || t.age_group === selectedAge
    const matchesFocus = selectedFocus === 'all' || t.focus_type === selectedFocus
    return matchesAge && matchesFocus
  })

  // Group by focus type for display
  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    const focus = template.focus_type
    if (!acc[focus]) acc[focus] = []
    acc[focus].push(template)
    return acc
  }, {} as Record<string, PracticeTemplate[]>)

  const getFocusLabel = (focus: string) => {
    const found = FOCUS_TYPES.find(f => f.value === focus)
    return found ? found.label : focus
  }

  const getFocusColor = (focus: string) => {
    switch (focus) {
      case 'balanced': return 'bg-blue-100 text-blue-700'
      case 'first-practice': return 'bg-green-100 text-green-700'
      case 'game-warmup': return 'bg-orange-100 text-orange-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading practice templates...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Practice Plan Library</h2>
        <p className="text-gray-600">Pre-built practice plans ready to use. Copy one to your plans and customize it.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 bg-white rounded-lg shadow p-4">
        <div className="flex items-center space-x-2">
          <Filter size={20} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Filter:</span>
        </div>
        <div>
          <select
            value={selectedAge}
            onChange={(e) => setSelectedAge(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {AGE_GROUPS.map(age => (
              <option key={age.value} value={age.value}>{age.label}</option>
            ))}
          </select>
        </div>
        <div>
          <select
            value={selectedFocus}
            onChange={(e) => setSelectedFocus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {FOCUS_TYPES.map(focus => (
              <option key={focus.value} value={focus.value}>{focus.label}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-500 flex items-center">
          {filteredTemplates.length} plan{filteredTemplates.length !== 1 ? 's' : ''} found
        </div>
      </div>

      {/* Templates */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FileText className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600">No templates match your filters</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedTemplates).map(([focus, focusTemplates]) => (
            <div key={focus}>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <span className={`px-3 py-1 rounded-full text-sm mr-3 ${getFocusColor(focus)}`}>
                  {getFocusLabel(focus)}
                </span>
                <span className="text-gray-400 text-sm font-normal">
                  {focusTemplates.length} plan{focusTemplates.length !== 1 ? 's' : ''}
                </span>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {focusTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="bg-white rounded-lg shadow overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-semibold text-gray-900">{template.title}</h4>
                        <button
                          onClick={() => copyToMyPlans(template)}
                          disabled={copying === template.id}
                          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            copied === template.id
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          } disabled:opacity-50`}
                        >
                          {copied === template.id ? (
                            <>
                              <Check size={16} />
                              <span>Copied!</span>
                            </>
                          ) : copying === template.id ? (
                            <span>Copying...</span>
                          ) : (
                            <>
                              <Copy size={16} />
                              <span>Use This</span>
                            </>
                          )}
                        </button>
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-3">{template.description}</p>
                      
                      <div className="flex flex-wrap gap-2 mb-3">
                        <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                          <Users size={12} className="mr-1" />
                          {template.age_group}
                        </span>
                        <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                          <Clock size={12} className="mr-1" />
                          {template.duration_minutes} min
                        </span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs capitalize">
                          {template.skill_level}
                        </span>
                      </div>

                      <button
                        onClick={() => setExpandedTemplate(
                          expandedTemplate === template.id ? null : template.id
                        )}
                        className="text-sm text-blue-600 hover:text-blue-700 flex items-center"
                      >
                        {expandedTemplate === template.id ? (
                          <>
                            <ChevronUp size={16} className="mr-1" />
                            Hide Details
                          </>
                        ) : (
                          <>
                            <ChevronDown size={16} className="mr-1" />
                            View Details
                          </>
                        )}
                      </button>
                    </div>

                    {expandedTemplate === template.id && template.content && (
                      <div className="border-t border-gray-100 p-4 bg-gray-50">
                        {template.content.overview && (
                          <p className="text-sm text-gray-700 mb-4 italic">
                            {template.content.overview}
                          </p>
                        )}
                        
                        {template.content.equipment && (
                          <div className="mb-4">
                            <div className="text-xs font-medium text-gray-500 mb-1">Equipment Needed:</div>
                            <div className="text-sm text-gray-700">
                              {template.content.equipment.join(', ')}
                            </div>
                          </div>
                        )}

                        <div className="text-xs font-medium text-gray-500 mb-2">Practice Blocks:</div>
                        <div className="space-y-3">
                          {template.content.blocks?.map((block: any, idx: number) => (
                            <div key={idx} className="bg-white rounded p-3 border border-gray-200">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-gray-900 text-sm">
                                  {block.title}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {block.minutes} min
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 mb-2">{block.description}</p>
                              {block.coaching_cues && (
                                <div className="text-xs">
                                  <span className="font-medium text-gray-500">Cues: </span>
                                  <span className="text-gray-600">
                                    {block.coaching_cues.slice(0, 2).join(' • ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
