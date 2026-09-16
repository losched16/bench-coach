'use client'

// The Drill Finder's browse surface: search, filters, the grid, and the detail.
//
// Separated from the page so the page is only the part that talks to Supabase
// and this is only the part a coach sees. That split exists for one concrete
// reason: the real surface lives behind a login, over a team, a coach and four
// tables, and a browser test of the page would spend all its effort on
// authentication and still not isolate what is under test.
//
// app/dev/drill-finder-harness mounts THIS component — not a copy, not a mock —
// over a fixture library shaped exactly like production, and
// scripts/acceptance-drill-finder.mjs drives it at 390, 430 and 1440. So the
// twenty acceptance conditions in the Phase 2D brief are checked against the
// code that ships.
//
// Everything about WHICH drills exist is the caller's problem. This component
// renders the pool it is handed and has no way to fetch a wider one — which is
// what keeps "source collections never appear" a property of the query rather
// than a promise made in JSX.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X, AlertCircle } from 'lucide-react'
import { DrillRecord } from '@/lib/drills'
import { environmentEligible, spaceEligible, equipmentEligible } from '@/lib/drillEligibility'
import { EQUIPMENT_OPTIONS } from '@/lib/practicePlan'
import {
  mediaForDrill, sharedCountFor, DrillMedia, PlayableMedia,
} from '@/lib/drillMedia'
import {
  searchDrills, applyFilters, EMPTY_FILTERS, activeFilterCount,
  categoriesIn, rolesIn, describeMedia, familyMembers, problemsFor,
  FinderFilters, FinderIndex,
} from '@/lib/drillFinder'
import { DrillCard } from './DrillCard'
import { DrillDetail } from './DrillDetail'
import { FilterSheet } from './FilterSheet'

export type FinderState = 'loading' | 'ready' | 'error'

export interface DrillFinderProps {
  drills: DrillRecord[]
  media: Map<string, DrillMedia[]>
  shareCounts: Map<string, number>
  index: FinderIndex | null
  favorites: Set<string>
  state: FinderState
  onRetry: () => void
  onToggleFavorite: (id: string) => void
  /** Absent when there is no team to add a drill to. */
  onAddToPractice?: (d: DrillRecord) => void
  /** Analytics. The page wires lib/tracking; the harness records calls. */
  onTrack?: (event: string, metadata?: any) => void
}

export function DrillFinder({
  drills, media, shareCounts, index, favorites, state,
  onRetry, onToggleFavorite, onAddToPractice, onTrack,
}: DrillFinderProps) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FinderFilters>({ ...EMPTY_FILTERS })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selected, setSelected] = useState<DrillRecord | null>(null)

  const track = (event: string, metadata?: any) => { if (onTrack) onTrack(event, metadata) }

  const filtered = useMemo(
    () => applyFilters(drills, filters, favorites, {
      environmentEligible, spaceEligible, equipmentEligible,
    }),
    [drills, filters, favorites]
  )

  const results = useMemo(
    () => searchDrills(filtered, query, index),
    [filtered, query, index]
  )

  const categories = useMemo(() => categoriesIn(drills), [drills])
  const roles = useMemo(() => rolesIn(drills), [drills])

  /** The one line a card is allowed to say about this drill's media. */
  const mediaLineFor = (d: DrillRecord) => {
    const best = mediaForDrill(d as any, media.get(d.id) || null)[0]
    if (!best) return null
    return describeMedia(best, sharedCountFor(best, shareCounts))
  }

  // ── analytics ─────────────────────────────────────────────────────────────

  const lastTrackedQuery = useRef('')
  useEffect(() => {
    const q = query.trim()
    if (!q || q === lastTrackedQuery.current) return
    // Debounced, or every keystroke of "dropping hands" is fourteen events.
    const t = setTimeout(() => {
      lastTrackedQuery.current = q
      track('drill_search', { query: q, results: results.length })
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, results.length])

  const changeFilters = (next: FinderFilters) => {
    setFilters(next)
    track('drill_filter_applied', {
      active: activeFilterCount(next),
      category: next.category, age: next.age, difficulty: next.difficulty,
    })
  }

  const openDrill = (d: DrillRecord, how: 'card' | 'variation' = 'card') => {
    setSelected(d)
    track('drill_detail_opened', { drillId: d.id, drillName: d.drill_name, via: how })
  }

  const onMediaClick = (d: DrillRecord, m: PlayableMedia) => {
    track('drill_media_clicked', {
      drillId: d.id,
      mediaType: m.media_type,
      verified: m.verification_status === 'verified',
      // Recorded because it is the number that decides whether this link was
      // worth showing, and after a few weeks it says whether curating
      // timestamps is worth doing.
      sharedWith: sharedCountFor(m, shareCounts),
    })
  }

  const addToPractice = onAddToPractice
    ? (d: DrillRecord) => {
        track('drill_added_to_practice', { drillId: d.id, drillName: d.drill_name })
        onAddToPractice(d)
      }
    : undefined

  const filterCount = activeFilterCount(filters)
  const clearEverything = () => { setQuery(''); setFilters({ ...EMPTY_FILTERS }) }

  return (
    <div className="space-y-5">
      {/* Search + filters. One row at every width — the filter button opens a
          sheet rather than expanding three cramped selects inline. */}
      <div className="flex gap-2">
        <div className="flex-1 relative min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
          <label htmlFor="drill-search" className="sr-only">Search drills</label>
          <input
            id="drill-search"
            type="search"
            placeholder="A drill, or the problem you are trying to fix"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          className={`shrink-0 inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-lg border font-medium text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            filterCount > 0
              ? 'bg-blue-50 border-blue-300 text-blue-800'
              : 'bg-white border-gray-300 text-gray-700'
          }`}
        >
          <SlidersHorizontal size={16} />
          Filters
          {filterCount > 0 && (
            <span className="min-w-[1.25rem] px-1 rounded-full bg-blue-600 text-white text-xs leading-5 text-center">
              {filterCount}
            </span>
          )}
        </button>
      </div>

      {/* Skill chips, so the commonest filter never needs the sheet. Derived
          from the rows: the previous version carried a hand-copied list of
          thirteen categories that nothing checked against the library. */}
      {state === 'ready' && categories.length > 0 && (
        <div className="-mx-1 px-1 overflow-x-auto">
          <div className="flex gap-1.5 w-max pb-1">
            {(['All'] as string[]).concat(categories).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => changeFilters({ ...filters, category: c })}
                aria-pressed={filters.category === c}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  filters.category === c
                    ? 'bg-gray-900 border-gray-900 text-white'
                    : 'bg-white border-gray-300 text-gray-700'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {state === 'ready' && (
        <p className="text-sm text-gray-600" role="status" aria-live="polite" data-testid="result-count">
          {results.length === drills.length
            ? `${results.length} drills`
            : `${results.length} of ${drills.length} drills`}
        </p>
      )}

      {/* ── states ─────────────────────────────────────────────────────────── */}

      {state === 'loading' && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div className="h-4 w-24 bg-gray-100 rounded" />
              <div className="mt-3 h-5 w-3/4 bg-gray-100 rounded" />
              <div className="mt-2 h-3 w-full bg-gray-100 rounded" />
              <div className="mt-1.5 h-3 w-5/6 bg-gray-100 rounded" />
              <div className="mt-4 h-3 w-40 bg-gray-100 rounded" />
              <div className="mt-5 h-8 w-44 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* A failed load says so and offers the thing that might fix it. It is
          not the empty state wearing a different hat, which is what it was. */}
      {state === 'error' && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center" data-testid="load-error">
          <AlertCircle className="mx-auto text-amber-500" size={28} />
          <p className="mt-3 font-medium text-gray-900">The drill library did not load.</p>
          <p className="mt-1 text-sm text-gray-600">
            Your drills are safe — this screen could not reach them just now.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Try again
          </button>
        </div>
      )}

      {state === 'ready' && results.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center" data-testid="empty">
          <p className="font-medium text-gray-900">
            {query ? `Nothing matches “${query}”.` : 'Nothing matches those filters.'}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {filters.favoritesOnly
              ? 'You are only seeing drills you have saved.'
              : query && filterCount > 0
                ? 'Try clearing a filter, or searching for the problem rather than the drill.'
                : query
                  ? 'Try the problem you are trying to fix — “dropping hands”, “afraid of fly balls”.'
                  : 'Try widening one of them.'}
          </p>
          {(query || filterCount > 0) && (
            <button
              type="button"
              onClick={clearEverything}
              className="mt-4 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Clear search and filters
            </button>
          )}
        </div>
      )}

      {state === 'ready' && results.length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="grid">
          {results.map(({ drill, via }) => (
            <DrillCard
              key={drill.id}
              drill={drill}
              matchedProblem={via || null}
              media={mediaLineFor(drill)}
              isFavorite={!!drill.id && favorites.has(drill.id)}
              onOpen={d => openDrill(d, 'card')}
              onToggleFavorite={onToggleFavorite}
              onAddToPractice={addToPractice}
            />
          ))}
        </div>
      )}

      <FilterSheet
        open={sheetOpen}
        filters={filters}
        onChange={changeFilters}
        onClose={() => setSheetOpen(false)}
        categories={categories}
        roles={roles}
        equipmentOptions={EQUIPMENT_OPTIONS}
        resultCount={results.length}
      />

      {selected && (
        <DrillDetail
          drill={selected}
          problems={problemsFor(selected, index)}
          relatives={familyMembers(selected, drills)}
          media={mediaForDrill(selected as any, media.get(selected.id) || null).map(p => ({
            playable: p,
            presentation: describeMedia(p, sharedCountFor(p, shareCounts)),
          }))}
          isFavorite={!!selected.id && favorites.has(selected.id)}
          onClose={() => setSelected(null)}
          onToggleFavorite={onToggleFavorite}
          onAddToPractice={addToPractice}
          onOpenRelative={d => openDrill(d, 'variation')}
          onMediaClick={onMediaClick}
        />
      )}
    </div>
  )
}
