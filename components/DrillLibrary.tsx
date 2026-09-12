'use client'

// The drill library, as something you pick from while building a practice.
//
// One component, three jobs: the panel beside the timeline on a desktop, the
// bottom sheet on a phone, and the filtered picker that opens when a coach
// replaces a block. They are the same list with the same rules — splitting them
// would mean three places to fix the day a category changes.
//
// CATEGORIES ARE THE LIBRARY'S OWN
//
// The tabs a coach sees are not the values in the database. `skill_category`
// holds "Fielding (Infield)" and "Fielding (Fly Balls)", and separately
// "Bunting" and "Soft Toss" which are both hitting work. The map below is the
// translation, and it is here rather than in the data because renaming a tab
// should not mean a migration.
//
// Anything whose category matches no tab is still reachable through search and
// through All. A drill that falls out of the taxonomy should get harder to
// find, not impossible.

import { useMemo, useState } from 'react'
import { Search, Plus, Play, X, Loader2, Star } from 'lucide-react'
import { DrillResource } from '@/lib/useDrillResources'

/** Tab label -> the skill_category values it covers. */
const CATEGORIES: Array<{ label: string; match?: string[] }> = [
  { label: 'Recommended' },
  { label: 'Hitting', match: ['hitting', 'bunting', 'soft toss'] },
  { label: 'Infield', match: ['fielding (infield)'] },
  { label: 'Outfield', match: ['fielding (fly balls)'] },
  { label: 'Throwing', match: ['throwing', 'arm care'] },
  { label: 'Baserunning', match: ['baserunning'] },
  { label: 'Pitching', match: ['pitching'] },
  { label: 'Catching', match: ['catching'] },
  { label: 'Team Defense', match: ['team defense'] },
  { label: 'Warmups', match: ['warmup', 'athletic development'] },
  { label: 'Games' },
  { label: 'My Drills' },
  { label: 'All' },
]

/** The focus areas a coach picked, in the library's category words. */
const FOCUS_TO_CATEGORY: Record<string, string[]> = {
  hitting: ['hitting', 'bunting', 'soft toss'],
  throwing: ['throwing', 'arm care'],
  infield: ['fielding (infield)'],
  outfield: ['fielding (fly balls)'],
  catching: ['catching'],
  baserunning: ['baserunning'],
  pitching: ['pitching'],
  'game iq': ['team defense'],
}

const cat = (d: DrillResource) => String(d.skill_category || '').trim().toLowerCase()

/** A drill that plays like a game rather than a rep set. */
function isGame(d: any): boolean {
  if (d?.competition_style && String(d.competition_style).toLowerCase() !== 'none') return true
  return /\b(game|challenge|competition|contest|race|king of|knockout|tournament)\b/i
    .test(String(d?.drill_name || ''))
}

function difficultyLabel(d: DrillResource): string | null {
  const v = String(d.difficulty_level || '').trim()
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : null
}

export interface DrillLibraryProps {
  drills: DrillResource[]
  loading?: boolean
  /** Add this drill to the practice. */
  onAdd: (drill: DrillResource) => void
  /** Open the drill's video or detail, when the caller has somewhere to show it. */
  onPreview?: (drill: DrillResource) => void
  /** Focus areas of this practice — what "Recommended" means here. */
  recommendedFor?: string[]
  /** Whose drills count as "My Drills". */
  coachId?: string | null
  favorites?: Set<string>
  /** Sheet mode on a phone; the caller renders the sheet and passes this. */
  onClose?: () => void
  /** "Add" on the main panel, "Use this" in a replace picker. */
  addLabel?: string
  /** Start on a particular tab — a replace picker opens on the block's own skill. */
  initialCategory?: string
  heading?: string
}

export function DrillLibrary({
  drills, loading = false, onAdd, onPreview, recommendedFor = [], coachId = null,
  favorites, onClose, addLabel = 'Add', initialCategory, heading = 'Drill library',
}: DrillLibraryProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(
    initialCategory && CATEGORIES.some(c => c.label === initialCategory)
      ? initialCategory
      : (recommendedFor.length ? 'Recommended' : 'All')
  )

  const recommendedCats = useMemo(() => {
    const out = new Set<string>()
    for (const f of recommendedFor) {
      for (const c of FOCUS_TO_CATEGORY[String(f).toLowerCase()] || []) out.add(c)
    }
    return out
  }, [recommendedFor])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = drills || []

    if (q) {
      // Search ignores the tab. A coach who types a drill name wants that
      // drill, not that drill if it happens to live under the tab they left
      // open.
      list = list.filter(d =>
        String(d.drill_name || '').toLowerCase().includes(q) ||
        String(d.description || '').toLowerCase().includes(q) ||
        cat(d).includes(q))
    } else if (active === 'Recommended') {
      list = recommendedCats.size
        ? list.filter(d => recommendedCats.has(cat(d)))
        : list
    } else if (active === 'My Drills') {
      list = list.filter((d: any) =>
        (coachId && d.created_by_coach_id === coachId) ||
        (favorites && d.id && favorites.has(d.id)))
    } else if (active === 'Games') {
      list = list.filter(isGame)
    } else if (active !== 'All') {
      const match = CATEGORIES.find(c => c.label === active)?.match || []
      list = list.filter(d => match.includes(cat(d)))
    }

    // Favourites first — a coach who saved a drill wants to find it again —
    // then alphabetically so the list does not reshuffle between visits.
    return [...list].sort((a, b) => {
      const fa = favorites && a.id && favorites.has(a.id) ? 0 : 1
      const fb = favorites && b.id && favorites.has(b.id) ? 0 : 1
      if (fa !== fb) return fa - fb
      return String(a.drill_name || '').localeCompare(String(b.drill_name || ''))
    })
  }, [drills, query, active, recommendedCats, coachId, favorites])

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <h3 className="font-semibold text-gray-900 text-sm">{heading}</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 -m-1" aria-label="Close">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search drills…"
            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Horizontally scrolling chips rather than a wrapped block of twelve —
          on a phone that wrap costs four rows before a single drill is seen. */}
      <div className="px-3 pb-2 shrink-0 overflow-x-auto">
        <div className="flex gap-1.5 w-max">
          {CATEGORIES.filter(c => c.label !== 'Recommended' || recommendedFor.length > 0).map(c => (
            <button
              key={c.label}
              onClick={() => { setActive(c.label); setQuery('') }}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs transition-colors ${
                active === c.label && !query
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : results.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">
            {query ? `Nothing matches “${query}”.` : 'Nothing in this category yet.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {results.map((d, i) => {
              const fav = !!(favorites && d.id && favorites.has(d.id))
              const mins = Number((d as any).est_duration_minutes) || null
              const diff = difficultyLabel(d)
              return (
                <li key={d.id || `${d.drill_name}-${i}`}
                    className="rounded-lg border border-gray-200 p-2.5 hover:border-gray-300">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 leading-snug flex items-start gap-1.5">
                        {fav && <Star size={12} className="text-amber-500 fill-amber-500 shrink-0 mt-1" />}
                        <span>{d.drill_name}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500">
                        {d.skill_category && (
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{d.skill_category}</span>
                        )}
                        {mins && <span>{mins} min</span>}
                        {diff && <span>· {diff}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onPreview && (d.youtube_video_id || d.description) && (
                        <button
                          onClick={() => onPreview(d)}
                          className="p-1.5 text-gray-400 hover:text-gray-700"
                          aria-label={`Preview ${d.drill_name}`}
                        >
                          <Play size={15} />
                        </button>
                      )}
                      <button
                        onClick={() => onAdd(d)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
                      >
                        <Plus size={13} /> {addLabel}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
