'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Search, Loader2, Check, Play, AlertCircle } from 'lucide-react'
import { DrillVideo } from './DrillVideo'

// Picking a different drill.
//
// The plan already had a "these aren't landing, give me others" button, which
// asks the model to re-pick the whole set. That is the right tool when the
// approach is wrong and the wrong one when a coach has looked at ONE drill and
// decided they don't like it — they don't want a new plan, they want that drill
// swapped for a specific other one.
//
// So this is the library, filtered to the same part of the game, and the coach
// chooses. The old drill goes onto the priority's retired list, so a later
// "give me different drills" can't hand it straight back.

interface LibraryDrill {
  id: string
  drill_name: string
  description: string | null
  skill_category: string | null
  difficulty_level: string | null
  youtube_url: string | null
  youtube_video_id: string | null
  ai_coaching_notes: string | null
}

interface Props {
  coachId: string
  prescriptionId: string
  // The drill being replaced.
  replacing: { id: string; drill_name: string; skill_category: string | null }
  onCancel: () => void
  onSwapped: () => void
}

export function DrillSwap({ coachId, prescriptionId, replacing, onCancel, onSwapped }: Props) {
  const [drills, setDrills] = useState<LibraryDrill[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Start in the same part of the game, because that is nearly always what
  // they want — but let them look at everything, because sometimes it isn't.
  const [sameArea, setSameArea] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = sameArea && replacing.skill_category
        ? `/api/drills?category=${encodeURIComponent(replacing.skill_category)}`
        : '/api/drills'
      const res = await fetch(url)
      const d = await res.json()
      setDrills((d.drills || []).filter((x: LibraryDrill) => x.id !== replacing.id))
    } catch {
      setError('Could not load the drill library.')
    } finally {
      setLoading(false)
    }
  }, [sameArea, replacing.skill_category, replacing.id])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return drills
    return drills.filter(d =>
      d.drill_name.toLowerCase().includes(needle) ||
      (d.description || '').toLowerCase().includes(needle)
    )
  }, [drills, q])

  const swap = async (to: LibraryDrill) => {
    setBusy(to.id)
    setError(null)
    try {
      const res = await fetch('/api/prescribe/drills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId, prescriptionId,
          replaceDrillId: replacing.id,
          withDrillId: to.id,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Could not swap that drill')
      }
      onSwapped()
    } catch (e: any) {
      setError(e.message)
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Swap this drill</h3>
              <p className="text-sm text-gray-600 mt-0.5">
                Replacing <strong>{replacing.drill_name}</strong>
              </p>
            </div>
            <button onClick={onCancel} className="p-1 text-gray-400" aria-label="Cancel">
              <X size={20} />
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search drills…"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm"
              />
            </div>
          </div>

          {replacing.skill_category && (
            <button
              onClick={() => setSameArea(!sameArea)}
              className="mt-2 text-xs font-medium text-red-600"
            >
              {sameArea
                ? `Showing ${replacing.skill_category} drills — show everything`
                : `Showing everything — just ${replacing.skill_category}`}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {error && (
            <div className="flex gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 className="animate-spin" size={15} /> Loading the library…
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              Nothing matches that.
            </p>
          ) : (
            shown.map(d => (
              <div key={d.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{d.drill_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {d.skill_category && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {d.skill_category}
                        </span>
                      )}
                      {d.difficulty_level && (
                        <span className="text-xs text-gray-500">{d.difficulty_level}</span>
                      )}
                    </div>
                    {d.description && (
                      <p className="text-sm text-gray-600 mt-1.5 line-clamp-2">{d.description}</p>
                    )}
                    {/* Compact in a list of thirty: a button that becomes the
                        player in place, rather than thirty thumbnails. */}
                    {(d.youtube_url || d.youtube_video_id) && (
                      <div className="mt-2">
                        <DrillVideo
                          drillName={d.drill_name}
                          youtubeVideoId={d.youtube_video_id || undefined}
                          youtubeUrl={d.youtube_url || undefined}
                          compact
                        />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => swap(d)}
                    disabled={!!busy}
                    className="shrink-0 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold active:bg-gray-800 disabled:opacity-50"
                  >
                    {busy === d.id
                      ? <Loader2 size={15} className="animate-spin" />
                      : 'Use this'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl border border-gray-300 text-gray-700 font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
