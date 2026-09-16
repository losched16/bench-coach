'use client'

// One activity, as something a coach decides about.
//
// WHAT IS NOT ON THIS CARD
//
// The thumbnail, the play button, the channel name. Those were the top half of
// the old card and they were the least trustworthy thing on it: the library has
// zero curated timestamps, and 69 of the 154 schedulable activities point at a
// video that also backs another drill. A thumbnail with a play button over it
// promises a demonstration and delivers a coach to 0:00 of a compilation.
//
// WHAT IS ON IT INSTEAD
//
// The six things that decide whether you would run this on Tuesday: what it is
// called, what skill it trains, what it is FOR, how long it takes, how hard it
// is, and what you need to bring. All six are populated on 154 of 154 rows
// after Phase 2C, so this card renders completely for every activity in the
// library — which is the whole reason it can be built this way now and could
// not have been before.
//
// Media appears as one muted line at the bottom, labelled honestly, and is not
// a link. The link lives in the detail, underneath the instructions.

import { Clock, Users, Star, Plus, Video } from 'lucide-react'
import { DrillRecord } from '@/lib/drills'
import { contextChips, purposeLine, ProblemRef } from '@/lib/drillFinder'
import { MediaPresentation } from '@/lib/drillFinder'

export interface DrillCardProps {
  drill: DrillRecord
  /** The problem that made this a search hit, when one did. */
  matchedProblem?: ProblemRef | null
  /** How this drill's best media should be described, or null for no media. */
  media: MediaPresentation | null
  isFavorite: boolean
  onOpen: (d: DrillRecord) => void
  onToggleFavorite: (id: string) => void
  /** Absent when there is no practice to add to. */
  onAddToPractice?: (d: DrillRecord) => void
}

const CATEGORY_TONE: Record<string, string> = {
  'Hitting': 'bg-red-50 text-red-700 ring-red-100',
  'Soft Toss': 'bg-red-50 text-red-600 ring-red-100',
  'Bunting': 'bg-orange-50 text-orange-700 ring-orange-100',
  'Pitching': 'bg-purple-50 text-purple-700 ring-purple-100',
  'Throwing': 'bg-blue-50 text-blue-700 ring-blue-100',
  'Fielding (Infield)': 'bg-green-50 text-green-700 ring-green-100',
  'Fielding (Fly Balls)': 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  'Catching': 'bg-yellow-50 text-yellow-700 ring-yellow-100',
  'Baserunning': 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  'Team Defense': 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  'Arm Care': 'bg-teal-50 text-teal-700 ring-teal-100',
  'Warmup': 'bg-sky-50 text-sky-700 ring-sky-100',
  'Athletic Development': 'bg-lime-50 text-lime-700 ring-lime-100',
}

const DIFFICULTY_TONE: Record<string, string> = {
  Beginner: 'text-green-700',
  Intermediate: 'text-amber-700',
  Advanced: 'text-red-700',
}

/**
 * Equipment, as one line a coach can read at a glance.
 *
 * The library writes "Baseballs or wiffle balls" and "Batting tee (optional)",
 * so a full list runs to three lines on a phone. Two items and a count is
 * enough to answer "do I have to bring anything?", which is the only question
 * the card is being asked. The full list is in the detail.
 */
export function equipmentSummary(d: DrillRecord): string | null {
  const list = (Array.isArray(d.equipment_needed) ? d.equipment_needed : [])
    .map(x => String(x).trim()).filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1 && /^(none|no equipment)/i.test(list[0])) return 'No equipment'
  if (list.length <= 2) return list.join(', ')
  return `${list.slice(0, 2).join(', ')} +${list.length - 2}`
}

export function DrillCard({
  drill, matchedProblem, media, isFavorite, onOpen, onToggleFavorite, onAddToPractice,
}: DrillCardProps) {
  const chips = contextChips(drill).slice(0, 3)
  const purpose = purposeLine(drill)
  const equipment = equipmentSummary(drill)
  const mins = Number(drill.est_duration_minutes)
  const mine = !!drill.created_by_coach_id

  return (
    <article className="flex flex-col bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-shadow">
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {drill.skill_category && (
              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ring-1 ${
                CATEGORY_TONE[String(drill.skill_category)] || 'bg-gray-50 text-gray-700 ring-gray-100'
              }`}>
                {drill.skill_category}
              </span>
            )}
            {mine && (
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-900 text-white">
                Yours
              </span>
            )}
          </div>

          {/* stopPropagation, or starring a drill also opens it. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (drill.id) onToggleFavorite(drill.id) }}
            aria-label={isFavorite ? `Remove ${drill.drill_name} from favorites` : `Save ${drill.drill_name} to favorites`}
            aria-pressed={isFavorite}
            className="shrink-0 -m-1 p-1 rounded text-gray-300 hover:text-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Star size={18} className={isFavorite ? 'text-amber-500' : ''} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* The name is the button. The card is not a clickable div: a div with
            an onClick is invisible to a keyboard, which is how the old grid
            became unreachable without a mouse. */}
        <h3 className="mt-2">
          <button
            type="button"
            onClick={() => onOpen(drill)}
            className="text-left font-semibold text-gray-900 leading-snug hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            {drill.drill_name}
          </button>
        </h3>

        {purpose && (
          <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{purpose}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {Number.isFinite(mins) && mins > 0 && (
            <span className="inline-flex items-center gap-1"><Clock size={13} />{mins} min</span>
          )}
          {drill.age_range && (
            <span className="inline-flex items-center gap-1"><Users size={13} />{drill.age_range}</span>
          )}
          {drill.difficulty_level && (
            <span className={DIFFICULTY_TONE[String(drill.difficulty_level)] || ''}>
              {drill.difficulty_level}
            </span>
          )}
          {equipment && <span className="text-gray-500">{equipment}</span>}
        </div>

        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.map(c => (
              <span
                key={c.label}
                title={c.detail}
                className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]"
              >
                {c.label}
              </span>
            ))}
          </div>
        )}

        {/* Why this came back, when a coach searched a problem rather than a
            name. Without it a taxonomy hit looks like a random result. */}
        {matchedProblem && (
          <p className="mt-2.5 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 inline-block">
            Fixes: {matchedProblem.label}
          </p>
        )}
      </div>

      <div className="px-4 pb-3 pt-0">
        {/* The two actions, on one line, never wrapped mid-label. A button
            reading "Add to / practice" over two lines is how a three-column
            grid at 1440 made its primary action look like an accident. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(drill)}
            className="whitespace-nowrap px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            How to run it
          </button>
          {onAddToPractice && (
            <button
              type="button"
              onClick={() => onAddToPractice(drill)}
              className="whitespace-nowrap inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Plus size={14} /> Add to practice
            </button>
          )}
        </div>

        {/* Media: one muted line UNDER the actions, not a link and not a
            picture. It answers "is there something to watch?" without
            competing with what a coach came here to do, and it never says
            "watch this drill" for a video nobody has verified. A drill with no
            media simply has no line — there is no empty box, because there is
            nothing missing. */}
        {media && (
          <p
            title={media.note || undefined}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-400"
          >
            <Video size={12} /> {media.label}
          </p>
        )}
      </div>
    </article>
  )
}
