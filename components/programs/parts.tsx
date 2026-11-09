'use client'

// Pieces shared by the draft editor, the saved program and the daily workout.
// Everything here renders text the model or a coach wrote as plain text — no
// HTML injection, and links only for library videos resolved by id.

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DrillVideo } from '@/components/DrillVideo'

export const KIND_LABEL: Record<string, string> = {
  coached: 'Coached session', independent: 'Independent routine', strength: 'Strength', throwing: 'Throwing',
  assessment: 'Checkpoint', team: 'Team practice', recovery: 'Recovery', rest: 'Rest day',
}
// Colour is never the only signal: every chip carries its text label too.
export const KIND_STYLE: Record<string, string> = {
  coached: 'bg-blue-50 text-blue-800 border-blue-200', independent: 'bg-green-50 text-green-800 border-green-200',
  strength: 'bg-orange-50 text-orange-800 border-orange-200', throwing: 'bg-purple-50 text-purple-800 border-purple-200',
  assessment: 'bg-amber-50 text-amber-900 border-amber-300', team: 'bg-gray-50 text-gray-800 border-gray-200',
  recovery: 'bg-teal-50 text-teal-800 border-teal-200', rest: 'bg-gray-100 text-gray-600 border-gray-200',
}
export const SUPERVISION_LABEL: Record<string, string> = { independent: 'Player alone (easy work)', parent: 'Adult present', coach: 'Coach-led' }
export const SKILL_LABEL: Record<string, string> = {
  first_step: 'First step', acceleration: 'Acceleration', outfield_tracking: 'Outfield tracking', infield_fundamentals: 'Infield',
  hitting: 'Hitting', strength_athleticism: 'Strength', pitching_readiness: 'Pitching readiness', throwing: 'Throwing', catching: 'Catching', baserunning: 'Baserunning',
}

export function Chip({ kind, children }: { kind: string; children?: React.ReactNode }) {
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${KIND_STYLE[kind] || KIND_STYLE.team}`}>{children ?? KIND_LABEL[kind] ?? kind}</span>
}

export function dayName(date: string) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T00:00:00Z`).getUTCDay()] }
export function prettyDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export const today = () => new Date().toISOString().slice(0, 10)

export interface DrillLike {
  name: string; minutes: number; sets?: number | null; reps?: string | null; rest?: string | null; intensity?: string
  instructions?: string[]; cues?: string[]; success?: string[]; modification?: string | null
  drillId?: string | null; drill_id?: string | null; skill?: string | null
  exerciseKey?: string | null; exercise_key?: string | null
}

export type RelatedMap = Record<string, { drillId: string; name: string }>

export function DrillBody({ d, media, related, kid }: { d: DrillLike; media?: Record<string, any>; related?: RelatedMap; kid?: boolean }) {
  const id = d.drillId ?? d.drill_id ?? null
  const key = d.exerciseKey ?? d.exercise_key ?? null
  // The drill's own library video first; for a built-in exercise, a related one
  // (labelled as related) when the library has it. Nothing else is ever shown.
  const rel = !id && key ? related?.[key] : undefined
  const m = id ? media?.[id] : rel ? media?.[rel.drillId] : null
  const hasVid = !!(m && (m.youtube_video_id || m.youtube_url))
  const dose = [d.sets ? `${d.sets} sets` : null, d.reps || null, d.rest ? `rest ${d.rest}` : null].filter(Boolean).join(' · ')
  return (
    <div className="text-sm text-gray-800 space-y-2">
      {dose && <p><span className="font-medium">Do:</span> {dose}</p>}
      {!kid && d.instructions && d.instructions.length > 0 && (
        <ol className="list-decimal pl-5 space-y-1">{d.instructions.map((t, i) => <li key={i}>{t}</li>)}</ol>
      )}
      {d.cues && d.cues.length > 0 && <p><span className="font-medium">{kid ? 'Remember:' : 'Say:'}</span> {d.cues.join(' · ')}</p>}
      {!kid && d.success && d.success.length > 0 && <p><span className="font-medium">Good looks like:</span> {d.success.join('; ')}</p>}
      {!kid && d.modification && <p><span className="font-medium">Too hard or too easy?</span> {d.modification}</p>}
      {hasVid ? (
        <div>
          {rel && <p className="text-xs text-gray-600 mb-1">Related video from the drill library: {rel.name}</p>}
          <DrillVideo drillName={rel ? rel.name : d.name} youtubeVideoId={m.youtube_video_id || undefined} youtubeUrl={m.youtube_url || undefined}
            thumbnailUrl={m.thumbnail_url || undefined} channel={m.channel || undefined} startSeconds={m.youtube_start_seconds ?? undefined} compact />
        </div>
      ) : id ? <p className="text-xs text-gray-500">No approved video for this drill yet — the written steps are enough to run it.</p> : null}
    </div>
  )
}

/** A drill row that opens to show its instructions. Used read-only in the editor and the saved calendar. */
export function DrillRow({ d, media, related }: { d: DrillLike; media?: Record<string, any>; related?: RelatedMap }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border border-gray-200 rounded-lg bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left min-h-[44px]">
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className="flex-1 font-medium text-gray-900">{d.name}</span>
        <span className="text-xs text-gray-600">{d.minutes} min</span>
      </button>
      {open && <div className="px-4 pb-3"><DrillBody d={d} media={media} related={related} /></div>}
    </li>
  )
}
