'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Bookmark, Trash2, Search, Filter, Plus, Pencil } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface SavedDrill {
  id: string
  title: string
  content: string
  category: string
  created_at: string
}

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'general', label: 'General' },
  { value: 'hitting', label: 'Hitting' },
  { value: 'fielding', label: 'Fielding' },
  { value: 'throwing', label: 'Throwing' },
  { value: 'catching', label: 'Catching' },
  { value: 'baserunning', label: 'Baserunning' },
  { value: 'practice-plan', label: 'Practice Plans' },
  { value: 'game-situations', label: 'Game Situations' },
]

export default function DrillsPage() {
  const [drills, setDrills] = useState<SavedDrill[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [expandedDrill, setExpandedDrill] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [drillToDelete, setDrillToDelete] = useState<SavedDrill | null>(null)
  const [showDrillModal, setShowDrillModal] = useState(false)
  const [editingDrill, setEditingDrill] = useState<SavedDrill | null>(null)
  const [drillTitle, setDrillTitle] = useState('')
  const [drillContent, setDrillContent] = useState('')
  const [drillCategory, setDrillCategory] = useState('general')
  const [savingDrill, setSavingDrill] = useState(false)
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadDrills()
    }
  }, [teamId])

  const loadDrills = async () => {
    try {
      const { data } = await supabase
        .from('saved_drills')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      if (data) {
        setDrills(data)
      }
    } catch (error) {
      console.error('Error loading drills:', error)
    } finally {
      setLoading(false)
    }
  }

  const confirmDelete = (drill: SavedDrill) => {
    setDrillToDelete(drill)
    setShowDeleteModal(true)
  }

  const handleDelete = async () => {
    if (!drillToDelete) return

    try {
      await supabase
        .from('saved_drills')
        .delete()
        .eq('id', drillToDelete.id)

      setDrills(prev => prev.filter(d => d.id !== drillToDelete.id))
      setShowDeleteModal(false)
      setDrillToDelete(null)
    } catch (error) {
      console.error('Error deleting drill:', error)
      alert('Failed to delete drill')
    }
  }

  const openCreateModal = () => {
    setEditingDrill(null)
    setDrillTitle('')
    setDrillContent('')
    setDrillCategory('general')
    setShowDrillModal(true)
  }

  const openEditModal = (drill: SavedDrill) => {
    setEditingDrill(drill)
    setDrillTitle(drill.title)
    setDrillContent(drill.content)
    setDrillCategory(drill.category)
    setShowDrillModal(true)
  }

  const handleSaveDrill = async () => {
    if (!drillTitle.trim() || !drillContent.trim() || !teamId) return

    setSavingDrill(true)
    try {
      if (editingDrill) {
        // Update existing drill
        const { error } = await supabase
          .from('saved_drills')
          .update({
            title: drillTitle.trim(),
            content: drillContent.trim(),
            category: drillCategory,
          })
          .eq('id', editingDrill.id)

        if (error) throw error
      } else {
        // Create new drill
        const { error } = await supabase
          .from('saved_drills')
          .insert({
            team_id: teamId,
            title: drillTitle.trim(),
            content: drillContent.trim(),
            category: drillCategory,
          })

        if (error) throw error
      }

      setShowDrillModal(false)
      setEditingDrill(null)
      setDrillTitle('')
      setDrillContent('')
      loadDrills()
    } catch (error) {
      console.error('Error saving drill:', error)
      alert('Failed to save drill')
    } finally {
      setSavingDrill(false)
    }
  }

  // Filter drills by search and category
  const filteredDrills = drills.filter(drill => {
    const matchesSearch = searchQuery === '' || 
      drill.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      drill.content.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesCategory = selectedCategory === 'all' || drill.category === selectedCategory

    return matchesSearch && matchesCategory
  })

  if (loading) {
    return <div className="text-gray-600">Loading saved drills...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Saved Drills</h2>
          <p className="text-gray-600">Your custom drills and drills saved from chat</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          <span>Create Drill</span>
        </button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search drills..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Filter size={20} className="text-gray-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>
      </div>

      {filteredDrills.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Bookmark className="mx-auto text-gray-400 mb-4" size={48} />
          {drills.length === 0 ? (
            <>
              <p className="text-gray-600 mb-2">No saved drills yet</p>
              <p className="text-sm text-gray-500">
                When Claude gives you useful drills in chat, click "Save to Drills" to save them here.
              </p>
            </>
          ) : (
            <p className="text-gray-600">No drills match your search</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDrills.map((drill) => (
            <div
              key={drill.id}
              className="bg-white rounded-lg shadow overflow-hidden"
            >
              <div 
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedDrill(expandedDrill === drill.id ? null : drill.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{drill.title}</h3>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs capitalize">
                        {drill.category.replace('-', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {formatDate(drill.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditModal(drill)
                      }}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit drill"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        confirmDelete(drill)
                      }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete drill"
                    >
                      <Trash2 size={18} />
                    </button>
                    <div className={`text-gray-400 transition-transform ${expandedDrill === drill.id ? 'rotate-180' : ''}`}>
                      ▼
                    </div>
                  </div>
                </div>
                
                {expandedDrill !== drill.id && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                    {drill.content.substring(0, 150)}...
                  </p>
                )}
              </div>
              
              {expandedDrill === drill.id && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <div className="pt-4 prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap text-gray-700 text-sm">
                      {drill.content}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && drillToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Drill</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>"{drillToDelete.title}"</strong>? This cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  setDrillToDelete(null)
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

      {/* Create/Edit Drill Modal */}
      {showDrillModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {editingDrill ? 'Edit Drill' : 'Create New Drill'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Drill Name *
                </label>
                <input
                  type="text"
                  value={drillTitle}
                  onChange={(e) => setDrillTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Four Corners Throwing Drill"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category
                </label>
                <select
                  value={drillCategory}
                  onChange={(e) => setDrillCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {CATEGORIES.filter(c => c.value !== 'all').map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Include setup, how to run it, coaching cues, and any variations
                </p>
                <textarea
                  value={drillContent}
                  onChange={(e) => setDrillContent(e.target.value)}
                  rows={12}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  placeholder={`Example format:

**Setup:**
- 4 cones in a square, 30 feet apart
- Players at each cone with one ball

**How to Run:**
1. Player throws to the person on their right
2. After throwing, they follow their throw
3. Continue for 2-3 minutes

**Coaching Cues:**
- "Step toward your target"
- "Follow through"

**Variations:**
- Make it a competition (no drops)
- Add grounders instead of throws`}
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => {
                    setShowDrillModal(false)
                    setEditingDrill(null)
                  }}
                  disabled={savingDrill}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDrill}
                  disabled={!drillTitle.trim() || !drillContent.trim() || savingDrill}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingDrill ? 'Saving...' : editingDrill ? 'Save Changes' : 'Create Drill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
