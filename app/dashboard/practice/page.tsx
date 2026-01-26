'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus, Clock, ChevronDown, ChevronUp, Trash2, Pencil, Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface PracticePlan {
  id: string
  title: string
  duration_minutes: number
  focus: string[]
  focus_areas: string[]
  content: any
  created_at: string
}

export default function PracticePage() {
  const [plans, setPlans] = useState<PracticePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [planToDelete, setPlanToDelete] = useState<PracticePlan | null>(null)
  const [duration, setDuration] = useState(90)
  const [focusAreas, setFocusAreas] = useState<string[]>([])
  
  // Custom plan state
  const [customTitle, setCustomTitle] = useState('')
  const [customDuration, setCustomDuration] = useState(60)
  const [customBlocks, setCustomBlocks] = useState<Array<{
    title: string
    minutes: number
    description: string
    coaching_cues: string
  }>>([{ title: '', minutes: 10, description: '', coaching_cues: '' }])
  const [savingCustom, setSavingCustom] = useState(false)
  
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

  const confirmDelete = (plan: PracticePlan) => {
    setPlanToDelete(plan)
    setShowDeleteModal(true)
  }

  const handleDelete = async () => {
    if (!planToDelete) return

    try {
      await supabase
        .from('practice_plans')
        .delete()
        .eq('id', planToDelete.id)

      setPlans(prev => prev.filter(p => p.id !== planToDelete.id))
      setShowDeleteModal(false)
      setPlanToDelete(null)
    } catch (error) {
      console.error('Error deleting plan:', error)
      alert('Failed to delete practice plan')
    }
  }

  const addBlock = () => {
    setCustomBlocks([...customBlocks, { title: '', minutes: 10, description: '', coaching_cues: '' }])
  }

  const removeBlock = (index: number) => {
    if (customBlocks.length > 1) {
      setCustomBlocks(customBlocks.filter((_, i) => i !== index))
    }
  }

  const updateBlock = (index: number, field: string, value: string | number) => {
    const updated = [...customBlocks]
    updated[index] = { ...updated[index], [field]: value }
    setCustomBlocks(updated)
  }

  const handleSaveCustomPlan = async () => {
    if (!customTitle.trim() || !teamId) return
    
    // Filter out empty blocks
    const validBlocks = customBlocks.filter(b => b.title.trim() && b.description.trim())
    if (validBlocks.length === 0) {
      alert('Please add at least one block with a title and description')
      return
    }

    setSavingCustom(true)
    try {
      const content = {
        blocks: validBlocks.map(b => ({
          title: b.title,
          minutes: b.minutes,
          description: b.description,
          coaching_cues: b.coaching_cues.split('\n').filter(c => c.trim()),
        }))
      }

      const { error } = await supabase
        .from('practice_plans')
        .insert({
          team_id: teamId,
          title: customTitle.trim(),
          duration_minutes: customDuration,
          content: content,
        })

      if (error) throw error

      setShowCustomModal(false)
      setCustomTitle('')
      setCustomBlocks([{ title: '', minutes: 10, description: '', coaching_cues: '' }])
      loadPlans()
    } catch (error) {
      console.error('Error saving custom plan:', error)
      alert('Failed to save practice plan')
    } finally {
      setSavingCustom(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading practice plans...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Practice Plans</h2>
        
        {/* New Plan Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowNewMenu(!showNewMenu)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            <span>New Plan</span>
            <ChevronDown size={16} />
          </button>
          
          {showNewMenu && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowNewMenu(false)}
              />
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                <div className="p-2">
                  <button
                    onClick={() => {
                      setShowNewMenu(false)
                      setShowPlanModal(true)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
                  >
                    <Sparkles size={20} className="text-purple-600" />
                    <div>
                      <div className="font-medium text-gray-900">Generate with AI</div>
                      <div className="text-sm text-gray-500">Let AI create a plan</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowNewMenu(false)
                      setShowCustomModal(true)
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
                  >
                    <Pencil size={20} className="text-blue-600" />
                    <div>
                      <div className="font-medium text-gray-900">Create Custom</div>
                      <div className="text-sm text-gray-500">Write your own plan</div>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
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
            <div key={plan.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {plan.title}
                  </h3>
                  <button
                    onClick={() => confirmDelete(plan)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete plan"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                  <span className="flex items-center space-x-1">
                    <Clock size={16} />
                    <span>{plan.duration_minutes} min</span>
                  </span>
                  <span>{formatDate(plan.created_at)}</span>
                </div>
                {((plan.focus && plan.focus.length > 0) || (plan.focus_areas && plan.focus_areas.length > 0)) && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(plan.focus || plan.focus_areas || []).map((f) => (
                      <span
                        key={f}
                        className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs capitalize"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center"
                >
                  {expandedPlan === plan.id ? (
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
              
              {/* Expanded Content */}
              {expandedPlan === plan.id && plan.content && (
                <div className="border-t border-gray-100 p-6 bg-gray-50">
                  {/* Handle both old format (blocks array) and new format (content.blocks) */}
                  {(Array.isArray(plan.content) ? plan.content : plan.content.blocks)?.map((block: any, idx: number) => (
                    <div key={idx} className="mb-4 last:mb-0 bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900">{block.title}</h4>
                        <span className="text-sm text-gray-500">{block.minutes} min</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{block.description}</p>
                      
                      {block.setup && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-gray-500">Setup: </span>
                          <span className="text-xs text-gray-600">{block.setup}</span>
                        </div>
                      )}
                      
                      {block.coaching_cues && block.coaching_cues.length > 0 && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-gray-500">Coaching Cues:</span>
                          <ul className="list-disc list-inside text-xs text-gray-600 mt-1">
                            {block.coaching_cues.map((cue: string, i: number) => (
                              <li key={i}>{cue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {block.common_mistakes && block.common_mistakes.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">Watch For:</span>
                          <ul className="list-disc list-inside text-xs text-gray-600 mt-1">
                            {block.common_mistakes.map((mistake: string, i: number) => (
                              <li key={i}>{mistake}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

      {/* Delete Confirmation Modal */}
      {showDeleteModal && planToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Practice Plan</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>"{planToDelete.title}"</strong>? This cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  setPlanToDelete(null)
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Plan Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Create Custom Practice Plan</h3>
            
            <div className="space-y-6">
              {/* Plan Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Plan Title *
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Tuesday Hitting Focus Practice"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Total Duration (minutes)
                  </label>
                  <select
                    value={customDuration}
                    onChange={(e) => setCustomDuration(Number(e.target.value))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                    <option value={75}>75 minutes</option>
                    <option value={90}>90 minutes</option>
                    <option value={120}>120 minutes</option>
                  </select>
                </div>
              </div>

              {/* Blocks */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Practice Blocks
                  </label>
                  <button
                    type="button"
                    onClick={addBlock}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    + Add Block
                  </button>
                </div>
                
                <div className="space-y-4">
                  {customBlocks.map((block, idx) => (
                    <div key={idx} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700">Block {idx + 1}</span>
                        {customBlocks.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeBlock(idx)}
                            className="text-sm text-red-600 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-4 gap-3 mb-3">
                        <div className="col-span-3">
                          <input
                            type="text"
                            value={block.title}
                            onChange={(e) => updateBlock(idx, 'title', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Block title (e.g., Warm-up, Hitting Stations)"
                          />
                        </div>
                        <div>
                          <div className="flex items-center">
                            <input
                              type="number"
                              value={block.minutes}
                              onChange={(e) => updateBlock(idx, 'minutes', parseInt(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              min="1"
                            />
                            <span className="ml-2 text-sm text-gray-500">min</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="mb-3">
                        <textarea
                          value={block.description}
                          onChange={(e) => updateBlock(idx, 'description', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="What are you doing in this block? Include setup and instructions..."
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Coaching Cues (one per line, optional)
                        </label>
                        <textarea
                          value={block.coaching_cues}
                          onChange={(e) => updateBlock(idx, 'coaching_cues', e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={`"Keep your elbow up"\n"Watch the ball into your glove"`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-3 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowCustomModal(false)
                    setCustomTitle('')
                    setCustomBlocks([{ title: '', minutes: 10, description: '', coaching_cues: '' }])
                  }}
                  disabled={savingCustom}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCustomPlan}
                  disabled={!customTitle.trim() || savingCustom}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingCustom ? 'Saving...' : 'Save Practice Plan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
