'use client'

// A bench for the Drill Finder. Development only.
//
// The Finder lives behind a login, over a coach, a team and four tables. A
// browser test of the real page would spend all its effort on authentication
// and still not isolate what is under test — so this mounts the real
// <DrillFinder>, the real cards, the real detail dialog and the real filter
// sheet over a fixture generated FROM production
// (scripts/build-finder-harness-fixture.ts), with no auth and no network.
//
// Every rule a coach meets in the shipped Finder is the same code path here.
// What is replaced is only the data loader.
//
// It renders nothing in production. `next build` still compiles the route, so
// it cannot rot silently, and there is no real data behind it in any case.
//
// The <pre id="state"> at the bottom is the point: the acceptance run reads the
// visible result set back and asserts on it, rather than on what the DOM
// happens to look like.

import { useMemo, useState } from 'react'
import { DrillFinder, FinderState } from '@/components/drillFinder/DrillFinder'
import { DrillRecord, isSchedulable } from '@/lib/drills'
import { groupByDrill, sharedVideoCounts, DrillMedia } from '@/lib/drillMedia'
import { buildFinderIndex, ProblemRef } from '@/lib/drillFinder'
import fixture from '@/scripts/fixtures/drill-finder-harness.json'

/**
 * Rows the Finder must never render.
 *
 * These are OFFERED to the bench, not withheld from it. A harness that simply
 * left them out would prove nothing — of course a collection does not appear if
 * nobody supplies one. They go through the same isSchedulable() gate that
 * useDrillResources and schedulableDrills apply in production, and the
 * acceptance run asserts they are gone on the far side of it.
 */
const FORBIDDEN: DrillRecord[] = [
  {
    id: 'forbidden-collection',
    drill_name: 'HARNESS Source Collection — 10 Best Throwing Drills',
    resource_kind: 'source_collection',
    skill_category: 'Throwing',
    description: 'A compilation row. Must never appear in the Finder.',
  } as DrillRecord,
  {
    id: 'forbidden-teaching',
    drill_name: 'HARNESS Teaching Content — Why Arm Care Matters',
    resource_kind: 'teaching_content',
    skill_category: 'Arm Care',
    description: 'An explainer, not an activity. Must never appear in the Finder.',
  } as DrillRecord,
  {
    id: 'forbidden-duplicate',
    drill_name: 'HARNESS Duplicate Of One Hand Drill',
    resource_kind: 'activity',
    duplicate_of_drill_id: 'some-canonical-id',
    skill_category: 'Hitting',
    description: 'A true duplicate. Must never appear in the Finder.',
  } as DrillRecord,
]

export default function DrillFinderHarness() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [state, setState] = useState<FinderState>('ready')
  const [events, setEvents] = useState<Array<{ event: string; metadata: any }>>([])
  const [added, setAdded] = useState<Array<{ id: string; name: string }>>([])

  // The pool, assembled the way production assembles it: everything the data
  // layer has, narrowed by isSchedulable. The three FORBIDDEN rows go in here
  // and must not come out.
  const supplied = (fixture.drills as unknown as DrillRecord[]).concat(FORBIDDEN)
  const drills = supplied.filter(d => isSchedulable(d))
  const media = useMemo(() => groupByDrill(fixture.media as unknown as DrillMedia[]), [])
  const shareCounts = useMemo(() => sharedVideoCounts(fixture.media as unknown as DrillMedia[]), [])
  const index = useMemo(
    () => buildFinderIndex(fixture.taxonomy as ProblemRef[], fixture.mappings as any[]),
    []
  )

  if (process.env.NODE_ENV === 'production') return null

  return (
    <div className="max-w-6xl mx-auto p-4 bg-gray-50 min-h-screen">
      {/* Bench controls. Not part of the surface under test. */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(['ready', 'loading', 'error'] as FinderState[]).map(s => (
          <button
            key={s}
            data-testid={`set-state-${s}`}
            onClick={() => setState(s)}
            className={`px-2 py-1 rounded border ${state === s ? 'bg-gray-900 text-white' : 'bg-white'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <DrillFinder
        drills={drills}
        media={media}
        shareCounts={shareCounts}
        index={index}
        favorites={favorites}
        state={state}
        onRetry={() => setState('ready')}
        onToggleFavorite={(id) => setFavorites(prev => {
          const next = new Set(prev)
          next.has(id) ? next.delete(id) : next.add(id)
          return next
        })}
        onAddToPractice={(d) => setAdded(prev => prev.concat([{ id: String(d.id), name: String(d.drill_name) }]))}
        onTrack={(event, metadata) => setEvents(prev => prev.concat([{ event, metadata: metadata || null }]))}
      />

      <pre id="state" data-testid="state" style={{ display: 'none' }}>
        {JSON.stringify({
          // Every drill the bench HANDED the Finder, including the three it must
          // never render. The acceptance run compares this against what is on
          // screen, so "collections never appear" is proved by the surface
          // refusing them rather than by nobody offering them.
          supplied: supplied.map(d => String(d.drill_name)),
          schedulable: drills.map(d => String(d.drill_name)),
          forbidden: FORBIDDEN.map(d => String(d.drill_name)),
          favorites: Array.from(favorites),
          added,
          events,
        })}
      </pre>
    </div>
  )
}
