'use client'

import { useEffect, useState } from 'react'
import { Play, RefreshCw, Loader2, AlertCircle, Wrench, Shuffle } from 'lucide-react'
import { DrillOptions, OptionDrill } from './DrillOptions'
import { watchUrl } from '@/lib/drillVideo'

// The drills attached to a running priority.
//
// These were always stored on the prescription and never shown after the day
// it was issued — so a coach who wanted to run the work three days later had
// nowhere to look it up. That is most of what "I'm working on this" means.

interface Drill {
  id: string
  drill_name: string
  description: string | null
  youtube_video_id: string | null
  youtube_url: string | null
  thumbnail_url: string | null
  channel: string | null
  difficulty_level: string | null
  equipment_needed: string[] | null
  ai_coaching_notes: string | null
  reps_guidance?: string | null
  frequency_guidance?: string | null
}

interface Props {
  prescriptionId: string
  coachId: string
  onSwapped?: () => void
}

export function PriorityDrills({ prescriptionId, coachId, onSwapped }: Props) {
  const [drills, setDrills] = useState<Drill[]>([])
  const [swaps, setSwaps] = useState(0)
  const [loading, setLoading] = useState(true)
  const [swapping, setSwapping] = useState(false)
  const [askingWhy, setAskingWhy] = useState(false)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which slot is being reconsidered, and what it could become.
  const [optionsFor, setOptionsFor] = useState<string | null>(null)
  const [options, setOptions] = useState<OptionDrill[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/prescribe/drills?prescriptionId=${prescriptionId}&coachId=${coachId}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setDrills(d.drills || [])
        setSwaps(d.swaps || 0)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [prescriptionId, coachId])

  // Options for ONE slot. Nothing is written until the coach picks — a swap
  // counter that ticked on "let me look" would poison the signal the check-in
  // reads off it.
  const showOptions = async (drillId: string) => {
    setOptionsFor(drillId)
    setOptions([])
    setLoadingOptions(true)
    setError(null)
    try {
      const res = await fetch('/api/prescribe/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prescriptionId, coachId, replaceDrillId: drillId, count: 3 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not find options')
      setOptions(data.options || [])
    } catch (e: any) {
      setError(e.message)
      setOptionsFor(null)
    } finally {
      setLoadingOptions(false)
    }
  }

  const pickOption = async (replaceDrillId: string, chosen: OptionDrill) => {
    setOptionsFor(null)
    // Optimistic: the swap is a single row update and the coach is standing
    // at a field waiting to read it.
    setDrills(prev => prev.map(d => (d.id === replaceDrillId ? { ...d, ...chosen } as any : d)))
    try {
      const res = await fetch('/api/prescribe/drills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prescriptionId, coachId, replaceDrillId, withDrillId: chosen.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not swap that drill')
      setSwaps(data.swaps ?? swaps + 1)
      if (data.readWarning) setNotice(data.readWarning)
      onSwapped?.()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const swap = async () => {
    setSwapping(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/prescribe/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prescriptionId, coachId, reason: reason.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not find different drills')

      if (data.exhausted) {
        setNotice(data.message)
      } else {
        setDrills(data.drills || [])
        setSwaps(data.swaps || swaps + 1)
        // Said at the moment it becomes true, not buried in help text.
        if (data.readWarning) setNotice(data.readWarning)
        onSwapped?.()
      }
      setAskingWhy(false)
      setReason('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSwapping(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
        <Loader2 className="animate-spin" size={15} /> Loading the drills…
      </div>
    )
  }

  if (drills.length === 0 && !notice) {
    return <p className="text-sm text-gray-500 py-2">No drills were attached to this priority.</p>
  }

  return (
    <div className="space-y-3">
      {drills.map((d, i) => (
        <div key={d.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
          <span className="shrink-0 w-6 h-6 rounded-full bg-white border border-gray-300 text-xs font-medium text-gray-600 flex items-center justify-center">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2 flex-wrap">
              <h5 className="font-medium text-gray-900 text-sm">{d.drill_name}</h5>
              {d.difficulty_level && (
                <span className="text-xs px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-600">
                  {d.difficulty_level}
                </span>
              )}
            </div>

            {d.description && <p className="text-sm text-gray-600 mt-1">{d.description}</p>}

            {/* How much and how often — the part that turns a video into a plan. */}
            {(d.reps_guidance || d.frequency_guidance) && (
              <p className="text-xs text-gray-700 mt-1.5">
                {[d.reps_guidance, d.frequency_guidance].filter(Boolean).join(' · ')}
              </p>
            )}

            {d.equipment_needed?.length ? (
              <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                <Wrench size={11} /> {d.equipment_needed.join(', ')}
              </p>
            ) : null}

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {(d.youtube_url || d.youtube_video_id) && (
                <a
                  href={watchUrl(d) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                >
                  <Play size={13} /> Watch{d.channel ? ` · ${d.channel}` : ''}
                </a>
              )}
              <button
                onClick={() => showOptions(d.id)}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
              >
                <Shuffle size={13} /> Other options
              </button>
            </div>

            {optionsFor === d.id && (
              <DrillOptions
                options={options}
                loading={loadingOptions}
                replacingName={d.drill_name}
                onPick={o => pickOption(d.id, o)}
                onCancel={() => setOptionsFor(null)}
              />
            )}
          </div>
        </div>
      ))}

      {notice && (
        <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <p>{notice}</p>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {!askingWhy ? (
        <button
          onClick={() => setAskingWhy(true)}
          className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={13} /> These aren&apos;t working — show me different drills
        </button>
      ) : (
        <div className="p-3 border border-gray-200 rounded-lg bg-white">
          <label className="block text-sm font-medium text-gray-800 mb-1">
            What&apos;s wrong with them? (optional)
          </label>
          <p className="text-xs text-gray-500 mb-2">
            &quot;Needs a net we don&apos;t have&quot;, &quot;too advanced&quot;, &quot;he&apos;s bored of it&quot; — anything
            here gets used to pick the replacements.
          </p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
            placeholder="Optional"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={swap}
              disabled={swapping}
              className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {swapping ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              {swapping ? 'Finding drills…' : 'Get different drills'}
            </button>
            <button
              onClick={() => { setAskingWhy(false); setReason('') }}
              disabled={swapping}
              className="px-3 py-1.5 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
