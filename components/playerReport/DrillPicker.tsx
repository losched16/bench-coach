'use client'

// Choosing the drills that go in the report.
//
// The coach is always the one who decides. BenchCoach offers a small number of
// candidates from its own library, per development area, and every one of them
// has to be added by hand. Nothing arrives in the report because a model
// thought it should.
//
// Three or four suggestions, not twenty. A coach reviewing drills for a player
// they know is making a judgement, and a long list is not more choice — it is
// the same choice made worse, on a phone, in a car park.
//
// A drill with no video is a normal outcome and shows its written description
// instead. A questionable video would be worse than none: the link goes in a
// document with the coach's name on it.

import { useState } from 'react'
import {
  Plus, Trash2, ChevronUp, ChevronDown, Search, Loader2,
  Video, VideoOff, Sparkles, PlayCircle,
} from 'lucide-react'
import { DrillVideo } from '@/components/DrillVideo'
import { useTracker } from '@/lib/tracking'

export interface PickedDrill {
  drillId: string
  focusAreaId: string | null
  includeVideo: boolean
  source: 'recommended' | 'manual'
  // Denormalised for rendering; the server rebuilds these from the library on
  // every save, so what is shown here is never what is trusted.
  name: string
  description: string | null
  reason: string | null
  youtubeVideoId: string | null
  youtubeUrl: string | null
  thumbnailUrl: string | null
  youtubeStartSeconds: number | null
  channel: string | null
}

interface Candidate {
  id: string
  snapshot: {
    drill_name: string
    description: string | null
    focus: string | null
    channel: string | null
    video_url: string | null
    video_start_seconds: number | null
  }
  recommendationReason: string
  youtubeVideoId: string | null
  youtubeUrl: string | null
  thumbnailUrl: string | null
  youtubeStartSeconds: number | null
  skillCategory: string | null
  equipment: string[]
  isCoachDrill: boolean
}

interface FocusAreaRef { id: string; label: string }

interface DrillPickerProps {
  reportId: string
  focusAreas: FocusAreaRef[]
  selected: PickedDrill[]
  onChange: (next: PickedDrill[]) => void
  disabled?: boolean
}

function toPicked(c: Candidate, focusAreaId: string | null, source: 'recommended' | 'manual'): PickedDrill {
  return {
    drillId: c.id,
    focusAreaId,
    includeVideo: true,
    source,
    name: c.snapshot.drill_name,
    description: c.snapshot.description,
    reason: c.recommendationReason,
    youtubeVideoId: c.youtubeVideoId,
    youtubeUrl: c.youtubeUrl,
    thumbnailUrl: c.thumbnailUrl,
    youtubeStartSeconds: c.youtubeStartSeconds,
    channel: c.snapshot.channel,
  }
}

export function DrillPicker({
  reportId, focusAreas, selected, onChange, disabled = false,
}: DrillPickerProps) {
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, string | null>>({})
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const track = useTracker()

  const chosenIds = new Set(selected.map(d => d.drillId))

  const fetchFor = async (key: string, payload: any) => {
    setLoadingKey(key)
    setNotice(n => ({ ...n, [key]: null }))
    try {
      const res = await fetch('/api/player-reports/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, ...payload }),
      })
      const data = await res.json()
      setCandidates(c => ({ ...c, [key]: data.drills || [] }))
      track('player_report_drill_recommended', {
        reportId, mode: data.mode || 'recommend', count: (data.drills || []).length,
      })
      if (!data.drills?.length) {
        setNotice(n => ({
          ...n,
          [key]: data.message || data.error || 'Nothing in the library matched that.',
        }))
      }
    } catch {
      setNotice(n => ({ ...n, [key]: 'Could not reach the drill library. Try again in a moment.' }))
    } finally {
      setLoadingKey(null)
    }
  }

  const add = (c: Candidate, focusAreaId: string | null, source: 'recommended' | 'manual') => {
    if (chosenIds.has(c.id)) return
    track('player_report_drill_selected', { reportId, drillId: c.id, source })
    onChange([...selected, toPicked(c, focusAreaId, source)])
  }

  const remove = (drillId: string) => onChange(selected.filter(d => d.drillId !== drillId))

  const move = (index: number, delta: number) => {
    const next = [...selected]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const toggleVideo = (drillId: string) => {
    onChange(selected.map(d =>
      d.drillId === drillId ? { ...d, includeVideo: !d.includeVideo } : d
    ))
  }

  const renderCandidate = (c: Candidate, focusAreaId: string | null, source: 'recommended' | 'manual') => {
    const already = chosenIds.has(c.id)
    const hasVideo = Boolean(c.youtubeVideoId || c.youtubeUrl)
    return (
      <li key={c.id} className="border border-gray-200 rounded-lg p-3 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-gray-900 text-sm">{c.snapshot.drill_name}</p>
            {c.snapshot.description && (
              <p className="mt-1 text-sm text-gray-600 line-clamp-3">{c.snapshot.description}</p>
            )}
            <p className="mt-1.5 text-xs text-gray-500">
              Recommended because: {c.recommendationReason}
            </p>
            {c.isCoachDrill && (
              <span className="mt-1.5 inline-block text-[11px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                Your own drill
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => add(c, focusAreaId, source)}
            disabled={already || disabled}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-500"
          >
            <Plus size={15} aria-hidden />
            {already ? 'Added' : 'Add'}
          </button>
        </div>

        {hasVideo ? (
          <>
            <button
              type="button"
              onClick={() => setPreview(preview === c.id ? null : c.id)}
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              <PlayCircle size={15} aria-hidden />
              {preview === c.id ? 'Hide preview' : 'Preview drill'}
            </button>
            {preview === c.id && (
              <DrillVideo
                drillName={c.snapshot.drill_name}
                youtubeVideoId={c.youtubeVideoId || undefined}
                youtubeUrl={c.youtubeUrl || undefined}
                thumbnailUrl={c.thumbnailUrl || undefined}
                channel={c.snapshot.channel || undefined}
                startSeconds={c.youtubeStartSeconds ?? undefined}
                compact
                autoExpand
              />
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-gray-400">
            No video for this one — the report will show the written instructions.
          </p>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-6">
      {/* ---- Suggestions, one block per development area ------------------ */}
      {focusAreas.length === 0 ? (
        <p className="text-sm text-gray-500">
          Add a development area on the previous step and BenchCoach can suggest drills for it.
          You can still search the library below.
        </p>
      ) : (
        focusAreas.map(area => {
          const key = `area:${area.id}`
          const list = candidates[key]
          return (
            <section key={area.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-semibold text-gray-900 text-sm">{area.label}</h3>
                <button
                  type="button"
                  onClick={() => fetchFor(key, { focusAreaId: area.id })}
                  disabled={disabled || loadingKey === key}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingKey === key
                    ? <Loader2 size={15} className="animate-spin" aria-hidden />
                    : <Sparkles size={15} className="text-red-600" aria-hidden />}
                  {list ? 'Show different drills' : 'Suggest drills'}
                </button>
              </div>

              {notice[key] && <p className="mt-2 text-sm text-gray-600">{notice[key]}</p>}

              {list && list.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {list.map(c => renderCandidate(c, area.id, 'recommended'))}
                </ul>
              )}
            </section>
          )
        })
      )}

      {/* ---- Manual search ------------------------------------------------ */}
      <section className="rounded-lg border border-gray-200 p-3">
        <h3 className="font-semibold text-gray-900 text-sm">Find a drill yourself</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Search the BenchCoach library by name or skill.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); fetchFor('search', { query }) }
            }}
            disabled={disabled}
            placeholder="e.g. ground balls, tee work"
            aria-label="Search the drill library"
            className="flex-1 min-w-0 px-3 py-2.5 text-[16px] border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
          />
          <button
            type="button"
            onClick={() => fetchFor('search', { query })}
            disabled={disabled || !query.trim() || loadingKey === 'search'}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loadingKey === 'search'
              ? <Loader2 size={15} className="animate-spin" aria-hidden />
              : <Search size={15} aria-hidden />}
            Search
          </button>
        </div>

        {notice['search'] && <p className="mt-2 text-sm text-gray-600">{notice['search']}</p>}

        {candidates['search']?.length > 0 && (
          <ul className="mt-3 space-y-2">
            {candidates['search'].map(c =>
              renderCandidate(c, focusAreas[0]?.id || null, 'manual')
            )}
          </ul>
        )}
      </section>

      {/* ---- What is actually in the report ------------------------------- */}
      <section>
        <h3 className="font-semibold text-gray-900 text-sm">
          In this report{selected.length > 0 && <span className="font-normal text-gray-500"> ({selected.length})</span>}
        </h3>

        {selected.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No drills yet. A report without drills is still a good report — the development
            areas stand on their own.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {selected.map((d, i) => {
              const area = focusAreas.find(a => a.id === d.focusAreaId)
              const hasVideo = Boolean(d.youtubeVideoId || d.youtubeUrl)
              return (
                <li key={d.drillId} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={disabled || i === 0}
                        aria-label={`Move ${d.name} up`}
                        className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
                      >
                        <ChevronUp size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={disabled || i === selected.length - 1}
                        aria-label={`Move ${d.name} down`}
                        className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
                      >
                        <ChevronDown size={16} aria-hidden />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 text-sm">{i + 1}. {d.name}</p>
                      {area && <p className="text-xs text-gray-500 mt-0.5">For: {area.label}</p>}
                      {!hasVideo && (
                        <p className="text-xs text-gray-400 mt-0.5">No video — instructions only</p>
                      )}

                      {hasVideo && (
                        <button
                          type="button"
                          onClick={() => toggleVideo(d.drillId)}
                          disabled={disabled}
                          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                          {d.includeVideo
                            ? <><Video size={14} aria-hidden /> Video link included</>
                            : <><VideoOff size={14} aria-hidden /> Video left out</>}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => remove(d.drillId)}
                      disabled={disabled}
                      aria-label={`Remove ${d.name} from the report`}
                      className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

export default DrillPicker
