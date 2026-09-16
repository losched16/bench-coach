'use client'

// THE DRILL FINDER
//
// Rebuilt in Phase 2D around one sentence: the drill is the product, media
// supports the drill.
//
// The version this replaces led every card with a YouTube thumbnail and a play
// button. That was a reasonable design for a library of videos and a bad one
// for this library: 219 media rows, ZERO curated timestamps, ZERO verified, and
// 69 of the 154 schedulable activities backed by a video that also backs
// another drill. The biggest, most confident element on the card delivered a
// coach to 0:00 of a twelve-minute compilation.
//
// Phase 2C is what makes the alternative possible. Every schedulable activity
// now carries a description, coaching cues, success markers, a regression and a
// progression — 154 of 154, measured. So a coach can choose and run a drill
// here without opening a video, and the video became what it always was: a
// useful extra, named honestly, at the bottom.
//
// THIS FILE IS THE DATA LAYER.
//
// Everything a coach sees is <DrillFinder>, which takes the library as a prop
// and cannot fetch a wider one. That is what keeps "a source collection never
// appears here" a property of the QUERY below rather than a promise made in
// JSX — and it is what lets app/dev/drill-finder-harness mount the real surface
// for a browser test without an auth session.
//
// WHAT STAYED EXACTLY AS IT WAS
//
// schedulableDrills. Source collections, teaching content and true duplicates
// are excluded by the query, and history still resolves through visibleDrills
// elsewhere. Nothing in this rewrite may widen what a coach can be offered.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Plus } from 'lucide-react'
import { usePageView, useTracker } from '@/lib/tracking'
import { schedulableDrills, DrillRecord } from '@/lib/drills'
import { loadAllMedia, groupByDrill, sharedVideoCounts, DrillMedia } from '@/lib/drillMedia'
import { buildFinderIndex, FinderIndex, ProblemRef } from '@/lib/drillFinder'
import { DrillForm } from '@/components/DrillForm'
import { DrillFinder, FinderState } from '@/components/drillFinder/DrillFinder'

export default function DrillLibraryPage() {
  usePageView('drills')
  const track = useTracker()

  const [drills, setDrills] = useState<DrillRecord[]>([])
  const [media, setMedia] = useState<Map<string, DrillMedia[]>>(new Map())
  const [shareCounts, setShareCounts] = useState<Map<string, number>>(new Map())
  const [index, setIndex] = useState<FinderIndex | null>(null)
  const [state, setState] = useState<FinderState>('loading')

  const [coachId, setCoachId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [showAddDrill, setShowAddDrill] = useState(false)

  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setState('error'); return }
    const { data: coach } = await supabase
      .from('coaches').select('id').eq('user_id', user.id).single() as { data: { id: string } | null }
    const cid = coach?.id || null
    setCoachId(cid)
    await Promise.all([loadDrills(cid), loadFavorites(cid), loadSupporting()])
  }

  const loadDrills = async (cid: string | null) => {
    setState('loading')
    try {
      // schedulableDrills, unchanged. This is the library a coach browses to
      // decide what to run, and a row classified as a compilation or a tutorial
      // is not something to run. Demoted rows still resolve by id through
      // visibleDrills wherever a saved plan names one.
      //
      // Ordered by name rather than by progression_level: that column is set on
      // 92 of 154 rows, so sorting on it pushed the other 62 to the bottom of
      // every category for a reason no coach could see. Relevance orders the
      // list when there is a query; alphabetical does when there is not.
      const { data, error } = await schedulableDrills(supabase, cid, '*').order('drill_name')
      if (error) throw error
      setDrills((data || []) as DrillRecord[])
      setState('ready')
    } catch (error) {
      // A failed load is NOT an empty library. The old page caught this, logged
      // it, and rendered "No drills found matching your criteria" with a Clear
      // filters button that could not possibly have helped.
      console.error('Error loading drills:', error)
      setState('error')
    }
  }

  /**
   * Media and the taxonomy.
   *
   * Both are enrichment and neither may fail the page. A missing
   * drill_media_resources costs a coach a video link; a missing taxonomy costs
   * them problem search. Losing the drill library over either would be a far
   * worse trade, so both swallow their errors and hand back an empty result.
   */
  const loadSupporting = async () => {
    const rows = await loadAllMedia(supabase)
    setMedia(groupByDrill(rows))
    setShareCounts(sharedVideoCounts(rows))

    try {
      const [{ data: tax }, { data: map }] = await Promise.all([
        supabase.from('problem_taxonomy').select('slug, label, aliases, skill_category'),
        supabase.from('drill_problem_map').select('drill_id, problem_slug'),
      ])
      setIndex(buildFinderIndex(tax as ProblemRef[], map as any[]))
    } catch {
      setIndex(buildFinderIndex([], []))
    }
  }

  const loadFavorites = async (cid: string | null) => {
    if (!cid) return
    try {
      const res = await fetch(`/api/drills/favorites?coachId=${cid}`)
      const d = await res.json()
      setFavorites(new Set<string>(d.drillIds || []))
    } catch { /* stars are not worth breaking the library over */ }
  }

  const toggleFavorite = async (drillId: string) => {
    if (!coachId) return
    const on = favorites.has(drillId)
    // Optimistic: a star that waits on a round trip feels broken.
    setFavorites(prev => {
      const next = new Set(prev)
      on ? next.delete(drillId) : next.add(drillId)
      return next
    })
    try {
      await fetch('/api/drills/favorites', {
        method: on ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, drillId }),
      })
    } catch {
      setFavorites(prev => {
        const next = new Set(prev)
        on ? next.add(drillId) : next.delete(drillId)
        return next
      })
    }
  }

  /**
   * Into the practice builder, by id.
   *
   * The canonical, schedulable id — `drills` is the schedulable pool, so a
   * source collection or a true duplicate cannot be handed over from here. The
   * builder already has a "must include these drills" path; this rides it
   * rather than inventing a second workflow, and the builder's own redundancy
   * rules still apply on the far side.
   *
   * Offered only when there is a team, because a practice plan is built for a
   * team and a button that leads to a workspace prompt is not an offer.
   */
  const addToPractice = teamId
    ? (d: DrillRecord) => {
        window.location.href =
          `/dashboard/practice?teamId=${encodeURIComponent(teamId)}&drill=${encodeURIComponent(String(d.id))}`
      }
    : undefined

  const mine = drills.filter(d => d.created_by_coach_id).length

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drill Library</h1>
          <p className="text-gray-600 text-sm">
            {drills.length} drills you can run
            {favorites.size > 0 && ` · ${favorites.size} saved`}
            {mine > 0 && ` · ${mine} of your own`}
          </p>
        </div>
        <button
          onClick={() => setShowAddDrill(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Plus size={16} /> Add your own
        </button>
      </div>

      {showAddDrill && (
        <DrillForm
          onCancel={() => setShowAddDrill(false)}
          onSaved={async () => {
            setShowAddDrill(false)
            await Promise.all([loadDrills(coachId), loadFavorites(coachId)])
          }}
        />
      )}

      <DrillFinder
        drills={drills}
        media={media}
        shareCounts={shareCounts}
        index={index}
        favorites={favorites}
        state={state}
        onRetry={() => loadDrills(coachId)}
        onToggleFavorite={toggleFavorite}
        onAddToPractice={addToPractice}
        onTrack={track}
      />
    </div>
  )
}
