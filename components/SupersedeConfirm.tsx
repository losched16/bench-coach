'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'

// Shown before a new priority replaces the one already running in the same
// focus area.
//
// The replacing itself is right — two swing corrections at once and you can't
// tell which cue failed. What was wrong was doing it silently: a coach typed a
// question into a box, and three weeks of a hitting plan was marked abandoned
// with no mention. This is the mention.

export interface Superseding {
  id: string
  priority: string | null
  age_days: number | null
  sessions_logged: number
}

interface Props {
  replacing: Superseding
  focusAreaLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SupersedeConfirm({ replacing, focusAreaLabel, busy, onConfirm, onCancel }: Props) {
  const area = focusAreaLabel.toLowerCase()
  const age = replacing.age_days
  const runs = replacing.sessions_logged

  // The weight of the decision is in these two numbers, so lead with them
  // rather than with a generic "are you sure".
  const standing =
    age === null
      ? `It's your current ${area} priority.`
      : age === 0
        ? `You set it today.`
        : `You set it ${age} day${age === 1 ? '' : 's'} ago.`

  const work =
    runs === 0
      ? 'Nothing has been logged against it yet.'
      : `${runs} session${runs === 1 ? '' : 's'} logged against it so far.`

  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg p-4">
      <div className="flex gap-3">
        <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-amber-900 mb-1">
            This replaces your current {area} priority
          </h4>
          <p className="text-sm text-amber-800 mb-2">
            {standing} {work}
          </p>

          {replacing.priority && (
            <blockquote className="text-sm text-amber-900 bg-white/70 border-l-2 border-amber-400 pl-3 py-2 mb-3">
              {replacing.priority}
            </blockquote>
          )}

          <p className="text-xs text-amber-800 mb-3">
            One priority per area of the game, on purpose — running two {area} corrections at once
            means you can&apos;t tell which one worked. Everything you&apos;ve logged stays; the old
            priority is closed out, not deleted.
            {runs > 0 && ' If it hasn’t had a fair run yet, keeping it is usually the better call.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onConfirm}
              disabled={busy}
              className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <Loader2 className="animate-spin" size={14} />}
              Replace it
            </button>
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Keep what I have
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
