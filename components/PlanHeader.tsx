'use client'

import { AlertTriangle, Compass, Target } from 'lucide-react'

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
  // The one goal and the three things to repeat all night. Both print on the
  // clipboard sheet, and both belong on screen too — a coach who reads the
  // plan in the app and the sheet on the field should not meet two different
  // versions of what tonight is for.
  objective?: string | null
  coachingPoints?: string[] | null
}

export function PlanHeader({ coachNotes, flags, objective, coachingPoints }: Props) {
  const list = (flags || []).filter(Boolean)
  const points = (coachingPoints || []).filter(Boolean)
  if (!coachNotes && list.length === 0 && !objective && points.length === 0) return null

  return (
    <div className="space-y-3">
      {objective && (
        <div className="bg-gray-900 text-white rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Target size={16} className="text-gray-300" />
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">
              Today&rsquo;s #1 goal
            </p>
          </div>
          <p className="text-base font-semibold leading-snug">{objective}</p>
        </div>
      )}

      {points.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Say these all practice
          </p>
          <ol className="space-y-1.5">
            {points.map((pt, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-800 leading-relaxed">
                <span className="font-bold text-gray-400 shrink-0">{i + 1}.</span>
                <span>{pt}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
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
