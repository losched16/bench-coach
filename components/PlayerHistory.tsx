'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Calendar, Clock, Loader2, Plus, BookOpen, User, Image as ImageIcon, AlertCircle, Play,
} from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'

// One player's history, read from the activity log.
//
// This replaces the Development Journal tab, which wrote to its own table.
// Having two places to record a lesson was not just untidy: only Log an Entry
// produced the observation the diagnosis engine adopts rather than argues
// with, so the door a coach happened to pick decided how much their
// instructor's read counted for. Migration 037 moved the journal rows across;
// this reads the result.
//
// Read-only on purpose. Recording happens in one place now.

interface Observation {
  id: string
  prompt_key: string | null
  body: string
}

interface Entry {
  id: string
  entry_type: string
  occurred_on: string
  title: string | null
  instructor_name: string | null
  duration_min: number | null
  image_urls: string[] | null
  observations: Observation[]
  legacy_journal_id?: string | null
}

const TYPE_LABEL: Record<string, { label: string; icon: string }> = {
  game: { label: 'Game', icon: '🏆' },
  scrimmage: { label: 'Scrimmage', icon: '⚾' },
  practice: { label: 'Practice', icon: '⚾' },
  home_session: { label: 'Home Session', icon: '🏠' },
  lesson: { label: 'Lesson', icon: '🎯' },
}

// The engine's keys, in the coach's words. instructor_diagnosis is called out
// differently from an ordinary note because it IS different — it is the one
// observation weighted above the box score.
const NOTE_LABEL: Record<string, string> = {
  instructor_diagnosis: 'What the instructor said to work on',
  worked_on: 'What we worked on',
  went_well: 'What went well',
  needs_work: 'Needs work',
  home_drills: 'At-home drills',
  unseen: "What the box score wouldn't show",
  outs: 'About the outs',
  context: 'Anything off',
  how_it_went: 'How it went',
  notes: 'Notes',
}

// The journal stored photos and videos together and tagged each one; entries
// stores a flat list of storage paths, so the type comes off the extension.
// Rendering an .mp4 into an <img> gives a broken-image icon, which looks like
// the file is gone rather than like it is a video.
const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|hevc)$/i

const NOTE_ORDER = [
  'instructor_diagnosis', 'worked_on', 'unseen', 'went_well', 'needs_work',
  'outs', 'how_it_went', 'home_drills', 'context', 'notes',
]

interface Props {
  coachId: string | null
  playerId: string
  playerName: string
  teamId: string | null
}

export function PlayerHistory({ coachId, playerId, playerName, teamId }: Props) {
  const supabase = createSupabaseComponentClient()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!coachId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ coachId, playerId, limit: '50' })
      if (teamId) params.set('teamId', teamId)
      const res = await fetch(`/api/log?${params}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load the history')
      setEntries(d.entries || [])
      setError(d.needsMigration ? (d.migrationMessage || 'The activity log tables are not set up yet.') : null)
    } catch (e: any) {
      // Never silently empty. An empty list that means "the request failed"
      // reads as "my history was deleted", which is the exact panic the
      // scouting page caused before it started saying so.
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [coachId, playerId, teamId])

  useEffect(() => { load() }, [load])

  // Storage paths are private; the bucket hands out short-lived signed URLs.
  useEffect(() => {
    const paths = entries.flatMap(e => e.image_urls || []).filter(p => !mediaUrls[p])
    if (paths.length === 0) return
    let cancelled = false
    ;(async () => {
      const next: Record<string, string> = {}
      for (const path of paths) {
        const { data } = await supabase.storage.from('journal-media').createSignedUrl(path, 3600)
        if (data?.signedUrl) next[path] = data.signedUrl
      }
      if (!cancelled && Object.keys(next).length) {
        setMediaUrls(prev => ({ ...prev, ...next }))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  const logHref = `/dashboard/log?teamId=${teamId || ''}&playerId=${playerId}`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">History</h2>
          <p className="text-sm text-gray-500">
            Every lesson, practice, game and home session logged for {playerName}.
          </p>
        </div>
        <Link
          href={logHref}
          className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          <Plus size={18} /><span>Add entry</span>
        </Link>
      </div>

      {error && (
        <div className="flex gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p>{error}</p>
            <button onClick={load} className="mt-1.5 underline font-medium">Try again</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-8">
          <Loader2 className="animate-spin" size={16} /> Loading the history…
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <BookOpen className="mx-auto text-gray-300 mb-4" size={64} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Nothing logged yet</h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Log a lesson, a practice or a backyard session and it shows up here — and
            feeds what {playerName} gets told to work on next.
          </p>
          <Link
            href={logHref}
            className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            <Plus size={18} /><span>Log the first one</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map(entry => {
            const type = TYPE_LABEL[entry.entry_type] || { label: entry.entry_type, icon: '📝' }
            const notes = [...(entry.observations || [])].sort(
              (a, b) =>
                (NOTE_ORDER.indexOf(a.prompt_key || '') + 1 || 99) -
                (NOTE_ORDER.indexOf(b.prompt_key || '') + 1 || 99)
            )
            const media = entry.image_urls || []

            return (
              <div key={entry.id} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50 gap-3">
                  <div className="flex items-center space-x-4 min-w-0">
                    <span className="text-2xl shrink-0">{type.icon}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">
                        {entry.title || type.label}
                        {entry.instructor_name && (
                          <span className="font-normal text-gray-500"> with {entry.instructor_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar size={14} />
                          {new Date(entry.occurred_on + 'T12:00:00').toLocaleDateString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                          })}
                        </span>
                        {entry.duration_min && (
                          <span className="flex items-center gap-1">
                            <Clock size={14} />{entry.duration_min} min
                          </span>
                        )}
                        {media.length > 0 && (
                          <span className="flex items-center gap-1">
                            <ImageIcon size={14} />{media.length} media
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {notes.length > 0 && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {notes.map(o => {
                      const isDiagnosis = o.prompt_key === 'instructor_diagnosis'
                      return (
                        <div
                          key={o.id}
                          className={`space-y-1 ${isDiagnosis ? 'md:col-span-2' : ''}`}
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            {isDiagnosis && <User size={14} className="text-red-600" />}
                            <span>{NOTE_LABEL[o.prompt_key || ''] || 'Note'}</span>
                          </div>
                          <p className={`text-sm whitespace-pre-wrap ${
                            isDiagnosis
                              ? 'text-gray-900 bg-red-50 border border-red-100 rounded-lg p-3'
                              : 'text-gray-600 pl-5'
                          }`}>
                            {o.body}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {media.length > 0 && (
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {media.map(path => (
                        <a
                          key={path}
                          href={mediaUrls[path] || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden block"
                        >
                          {!mediaUrls[path] ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <Loader2 className="animate-spin text-gray-400" size={18} />
                            </div>
                          ) : VIDEO_RE.test(path) ? (
                            <div className="w-full h-full flex items-center justify-center bg-gray-800">
                              <Play className="text-white" size={28} />
                            </div>
                          ) : (
                            <img src={mediaUrls[path]} alt="" className="w-full h-full object-cover" />
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
