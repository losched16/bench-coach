'use client'

import { Play, Wrench, Loader2, X } from 'lucide-react'

// Alternatives for one drill slot, to pick from.
//
// The old behaviour handed back a replacement set and swapped it in — so
// changing the one drill you disliked cost you the two you liked. Choosing
// beats being given, and it is the difference between a plan the coach
// received and a plan the coach built.

export interface OptionDrill {
  id: string
  drill_name: string
  description?: string | null
  youtube_video_id?: string | null
  youtube_url?: string | null
  channel?: string | null
  difficulty_level?: string | null
  equipment_needed?: string[] | null
}

interface Props {
  options: OptionDrill[]
  loading?: boolean
  replacingName?: string | null
  onPick: (drill: OptionDrill) => void
  onCancel: () => void
}

export function DrillOptions({ options, loading, replacingName, onPick, onCancel }: Props) {
  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-blue-900">
          {replacingName ? `Instead of ${replacingName}:` : 'Pick one:'}
        </p>
        <button onClick={onCancel} className="text-blue-400 hover:text-blue-700 shrink-0">
          <X size={15} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-blue-800 py-2">
          <Loader2 className="animate-spin" size={14} /> Finding options…
        </div>
      ) : options.length === 0 ? (
        <p className="text-sm text-blue-800">
          Nothing else in the library fits this one that you haven&apos;t already seen.
        </p>
      ) : (
        <div className="space-y-2">
          {options.map(o => (
            <div key={o.id} className="bg-white rounded-lg border border-blue-200 p-3">
              <div className="flex items-start gap-2 flex-wrap">
                <h6 className="font-medium text-gray-900 text-sm">{o.drill_name}</h6>
                {o.difficulty_level && (
                  <span className="text-xs px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">
                    {o.difficulty_level}
                  </span>
                )}
              </div>

              {o.description && <p className="text-sm text-gray-600 mt-1">{o.description}</p>}

              {o.equipment_needed?.length ? (
                <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                  <Wrench size={11} /> {o.equipment_needed.join(', ')}
                </p>
              ) : null}

              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => onPick(o)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
                >
                  Use this one
                </button>
                {/* Watching before choosing is the whole point of having a
                    video library — don't make them commit to see it. */}
                {(o.youtube_url || o.youtube_video_id) && (
                  <a
                    href={o.youtube_url || `https://www.youtube.com/watch?v=${o.youtube_video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                  >
                    <Play size={12} /> Watch first{o.channel ? ` · ${o.channel}` : ''}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
