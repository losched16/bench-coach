'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, Clock } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface PracticePlan {
  id: string
  title: string
  duration_minutes: number
  focus: string[]
  content: any
  created_at: string
}

export default function PracticePage() {
  const [plans, setPlans] = useState<PracticePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [duration, setDuration] = useState(90)
  const [focusAreas, setFocusAreas] = useState<string[]>([])
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  const FOCUS_OPTIONS = [
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

  useEffect(() => {
    if (teamId) {
      loadPlans()
    }
  }, [teamId])

  const loadPlans = async () => {
    try {
      const { data } = await supabase
        .from('practice_plans')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      if (data) {
        setPlans(data)
      }
    } catch (error) {
      console.error('Error loading plans:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleFocus = (focus: string) => {
    setFocusAreas(prev =>
      prev.includes(focus) ? prev.filter(f => f !== focus) : [...prev, focus]
    )
  }

  const handleGeneratePlan = async () => {
    if (focusAreas.length === 0 || !teamId) return

    setGenerating(true)

    try {
      const response = await fetch('/api/practice-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          duration,
          focus: focusAreas,
        }),
      })

      if (!response.ok) throw new Error('Failed to generate plan')

      const data = await response.json()

      // Save the plan
      await supabase
        .from('practice_plans')
        .insert({
          team_id: teamId,
          title: data.title,
          duration_minutes: duration,
          focus: focusAreas,
          content: data.blocks,
        })

      setShowPlanModal(false)
      setFocusAreas([])
      loadPlans()
    } catch (error) {
      console.error('Error generating plan:', error)
      alert('Failed to generate practice plan')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading practice plans...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Practice Plans</h2>
        <button
          onClick={() => setShowPlanModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          <span>Generate Plan</span>
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Clock className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600 mb-4">No practice plans yet</p>
          <button
            onClick={() => setShowPlanModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Generate Your First Plan
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {plan.title}
              </h3>
              <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                <span className="flex items-center space-x-1">
                  <Clock size={16} />
                  <span>{plan.duration_minutes} min</span>
                </span>
                <span>{formatDate(plan.created_at)}</span>
              </div>
              {plan.focus && plan.focus.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {plan.focus.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs capitalize"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {plan.content && plan.content.blocks && (
                <div className="text-sm text-gray-600 mb-4">
                  {plan.content.blocks.length} activities
                </div>
              )}
              <button
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                View Details →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Generate Plan Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Generate Practice Plan</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Duration (minutes)
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={60}>60 minutes</option>
                  <option value={75}>75 minutes</option>
                  <option value={90}>90 minutes</option>
                  <option value={120}>120 minutes</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Focus Areas (choose 1-3)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {FOCUS_OPTIONS.map((focus) => (
                    <button
                      key={focus}
                      type="button"
                      onClick={() => toggleFocus(focus)}
                      disabled={!focusAreas.includes(focus) && focusAreas.length >= 3}
                      className={`px-3 py-2 rounded-lg border-2 transition-colors text-sm capitalize ${
                        focusAreas.includes(focus)
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300 disabled:opacity-50'
                      }`}
                    >
                      {focus}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => setShowPlanModal(false)}
                  disabled={generating}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGeneratePlan}
                  disabled={focusAreas.length === 0 || generating}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? 'Generating...' : 'Generate Plan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
