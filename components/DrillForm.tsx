'use client'

import { useState } from 'react'
import { X, Loader2, AlertCircle, Trash2 } from 'lucide-react'

// A drill the coach writes themselves.
//
// Everything below the name is optional, and that is the design. A coach
// standing in a parking lot remembering the station their old travel coach ran
// should be able to type the name and one line and get out. The fields that
// make it useful to the practice builder — the dose, what to watch for — can
// be filled in later, or never.
//
// The one thing this form deliberately does NOT do is ask for a video. There
// is a field for it, at the bottom, optional. The entire reason this exists is
// the drills that will never have one.

const CATEGORIES = [
  'Hitting', 'Throwing', 'Fielding', 'Catching', 'Pitching',
  'Baserunning', 'Team Defense', 'Conditioning',
]

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced']

export interface EditableDrill {
  id?: string
  drill_name?: string
  description?: string | null
  skill_category?: string | null
  difficulty_level?: string | null
  equipment_needed?: string[] | null
  ai_coaching_notes?: string | null
  reps_guidance?: string | null
  frequency_guidance?: string | null
  success_markers?: string[] | null
  youtube_url?: string | null
}

interface Props {
  existing?: EditableDrill | null
  onCancel: () => void
  onSaved: () => void
}

export function DrillForm({ existing, onCancel, onSaved }: Props) {
  const [name, setName] = useState(existing?.drill_name || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [category, setCategory] = useState(existing?.skill_category || '')
  const [difficulty, setDifficulty] = useState(existing?.difficulty_level || '')
  const [equipment, setEquipment] = useState((existing?.equipment_needed || []).join(', '))
  const [cues, setCues] = useState(existing?.ai_coaching_notes || '')
  const [reps, setReps] = useState(existing?.reps_guidance || '')
  const [frequency, setFrequency] = useState(existing?.frequency_guidance || '')
  const [markers, setMarkers] = useState((existing?.success_markers || []).join('\n'))
  const [videoUrl, setVideoUrl] = useState(existing?.youtube_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!name.trim()) { setError('The drill needs a name.'); return }
    setSaving(true)
    setError(null)
    try {
      const body = {
        ...(existing?.id ? { drillId: existing.id } : {}),
        drill_name: name,
        description,
        skill_category: category || null,
        difficulty_level: difficulty || null,
        equipment_needed: equipment,
        coaching_notes: cues,
        reps_guidance: reps,
        frequency_guidance: frequency,
        // One per line — a coach listing two things to watch for should not
        // have to think about whether commas inside them will split wrongly.
        success_markers: markers.split('\n').map(s => s.trim()).filter(Boolean),
        youtube_url: videoUrl || null,
      }
      const res = await fetch('/api/drills/custom', {
        method: existing?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save that drill')
      onSaved()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing?.id) return
    if (!confirm(`Delete "${existing.drill_name}"?\n\nPractice plans that already used it keep their copy.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/drills/custom?drillId=${existing.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not delete that drill')
      }
      onSaved()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const field = 'w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm'
  const label = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {existing?.id ? 'Edit your drill' : 'Add your own drill'}
            </h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Only the name is required. Everything else makes it more useful when
              the app builds a practice around it.
            </p>
          </div>
          <button onClick={onCancel} className="p-1 text-gray-400" aria-label="Cancel">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="flex gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className={label}>What&apos;s it called? *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Four Corners Rundown"
              className={field}
              autoFocus
            />
          </div>

          <div>
            <label className={label}>How does it work?</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Setup and how to run it. Write it the way you'd explain it to a parent helping out for the first time — distances, how many kids, what happens."
              className={field}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Part of the game</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
                <option value="">—</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Level</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className={field}>
                <option value="">—</option>
                {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>What do you need?</label>
            <input
              value={equipment}
              onChange={e => setEquipment(e.target.value)}
              placeholder="bucket of balls, 4 cones, 1 glove each"
              className={field}
            />
            <p className="text-xs text-gray-500 mt-1">Separate with commas.</p>
          </div>

          <div>
            <label className={label}>What do you say while they do it?</label>
            <textarea
              value={cues}
              onChange={e => setCues(e.target.value)}
              rows={3}
              placeholder="The actual words. e.g. Glove out front, watch it all the way in, step at your target."
              className={field}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>How many</label>
              <input
                value={reps}
                onChange={e => setReps(e.target.value)}
                placeholder="3 rounds of 8"
                className={field}
              />
            </div>
            <div>
              <label className={label}>How often</label>
              <input
                value={frequency}
                onChange={e => setFrequency(e.target.value)}
                placeholder="2x a week"
                className={field}
              />
            </div>
          </div>

          <div>
            <label className={label}>How do you know it&apos;s working?</label>
            <textarea
              value={markers}
              onChange={e => setMarkers(e.target.value)}
              rows={2}
              placeholder="Fields through the ball moving forward, not waiting on it."
              className={field}
            />
            <p className="text-xs text-gray-500 mt-1">
              One per line. This is what a plan uses to tell you when to move on.
            </p>
          </div>

          <div>
            <label className={label}>Video link, if there is one</label>
            <input
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              className={field}
            />
            <p className="text-xs text-gray-500 mt-1">
              Most drills worth saving here don&apos;t have one. That&apos;s fine.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 space-y-2">
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-red-600 text-white font-bold flex items-center justify-center gap-2 active:bg-red-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={17} className="animate-spin" />}
            {existing?.id ? 'Save changes' : 'Save this drill'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-medium"
            >
              Cancel
            </button>
            {existing?.id && (
              <button
                onClick={remove}
                disabled={saving}
                className="px-4 py-3 rounded-xl border border-red-200 text-red-700 font-medium flex items-center gap-2 disabled:opacity-60"
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
