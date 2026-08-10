'use client'

import { AlertTriangle, Compass } from 'lucide-react'

// The coach talking, before the blocks.
//
// A practice plan that is only blocks is a schedule. These two fields are what
// make it coaching: why the practice is shaped this way and what to cut when
// it rains, and the problems in this coach's setup named before they meet them
// on the field.
//
// Rendered above the blocks in both the draft preview and the saved plan,
// because a coach who reads the flags after building the stations has been
// told nothing useful.

interface Props {
  coachNotes?: string | null
  flags?: string[] | null
}

export function PlanHeader({ coachNotes, flags }: Props) {
  const list = (flags || []).filter(Boolean)
  if (!coachNotes && list.length === 0) return null

  return (
    <div className="space-y-3">
      {coachNotes && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Compass size={16} className="text-blue-700" />
            <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
              How to run this
            </p>
          </div>
          <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
            {coachNotes}
          </p>
        </div>
      )}

      {list.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={16} className="text-amber-700" />
            <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
              Worth knowing before you start
            </p>
          </div>
          <ul className="space-y-2">
            {list.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-900 leading-relaxed">
                <span className="mt-0.5">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
