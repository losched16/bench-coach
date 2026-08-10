'use client'

import { useState } from 'react'
import { Star, Loader2, BookmarkPlus, Check } from 'lucide-react'
import { useDrillResources } from '@/lib/useDrillResources'

// Saving a drill from inside a practice plan.
//
// Favourites shipped on the Drill Library page, which is the wrong place on
// its own: nobody browses a library of 150 drills deciding what they like.
// They notice a drill is good while READING A PLAN — in the moment, with the
// setup and the cues in front of them — and that is where the button has to
// be.
//
// Two cases, and the second is the interesting one:
//
//   The block matches a library drill. Star it. Done.
//
//   The block does NOT match — the model wrote the station itself, which it
//   does whenever the library has no good fit. That drill currently exists in
//   exactly one practice plan and nowhere else. Saving it copies it into the
//   coach's own drills, where it is reusable, editable, and offered back to
//   them the next time a plan is built. A good station the app invented once
//   and then lost is a bad outcome.

interface Props {
  block: any
  coachId: string | null
  favorites: Set<string>
  onChanged: () => void
}

export function SaveDrillButton({ block, coachId, favorites, onChanged }: Props) {
  const { findDrill } = useDrillResources()
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!coachId) return null

  const match: any = findDrill(block.drill_name || block.title || '')
  const drillId: string | undefined = match?.id
  const starred = !!drillId && favorites.has(drillId)

  const toggleFavorite = async () => {
    if (!drillId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/drills/favorites', {
        method: starred ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, drillId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Could not save that.')
      }
      onChanged()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // The whole block becomes a drill. detailed_instructions is the description
  // because that is what the coach will read when they run it again; the cues
  // go to coaching notes, which is where every other surface renders them.
  const saveAsMine = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/drills/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drill_name: block.drill_name || block.title,
          description: [block.description, block.setup, block.detailed_instructions]
            .filter(Boolean)
            .join('\n\n'),
          coaching_notes: Array.isArray(block.coaching_cues)
            ? block.coaching_cues.join('\n')
            : block.coaching_cues || null,
          equipment_needed: block.equipment || [],
          success_markers: Array.isArray(block.success_indicators)
            ? block.success_indicators
            : [],
          youtube_video_id: block.youtube_video_id || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save that drill.')
      // The custom-drill route stars it on creation — somebody saving a drill
      // out of a plan has already said it is one they want.
      setJustSaved(true)
      onChanged()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const label = drillId
    ? (starred ? 'Saved' : 'Save this drill')
    : (justSaved ? 'Saved to your drills' : 'Save to my drills')

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={drillId ? toggleFavorite : saveAsMine}
        disabled={busy || justSaved}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
          starred || justSaved
            ? 'bg-amber-50 border-amber-300 text-amber-800'
            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
        } disabled:opacity-60`}
        title={
          drillId
            ? 'Keep this one — it will be offered first next time a plan is built'
            : 'This one is not in the library. Save it as your own so you can use it again.'
        }
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin" />
        ) : justSaved ? (
          <Check size={15} />
        ) : drillId ? (
          <Star size={15} fill={starred ? 'currentColor' : 'none'} />
        ) : (
          <BookmarkPlus size={15} />
        )}
        {label}
      </button>

      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  )
}
