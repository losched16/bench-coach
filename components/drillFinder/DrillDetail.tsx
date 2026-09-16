'use client'

// The whole drill, in the order a coach reads it before running it.
//
// Why use it → Setup → How it works → Coach it → Watch for → Make it easier →
// Make it harder → Safety → what it fixes → variations → media.
//
// MEDIA IS LAST AND THAT IS THE POINT
//
// It used to be first: the old modal opened with a full-width YouTube embed,
// then the channel name, then one paragraph. A coach who wanted to know how to
// run the drill had to scroll past a twelve-minute video to find two sentences.
// Now the instructions are the page and the video is an appendix — and the
// iframe is not even mounted until somebody asks for it, so a drill nobody
// watches costs nothing to open.
//
// KEYBOARD
//
// This is a real dialog. Escape closes it, focus moves into it and returns to
// whatever opened it, Tab is kept inside, and the page behind does not scroll.
// The thing it replaces had none of that: it was a plain div that could only be
// dismissed by finding the X with a mouse.

import { useEffect, useRef, useState } from 'react'
import { X, Plus, Star, ExternalLink, Play } from 'lucide-react'
import { DrillRecord } from '@/lib/drills'
import { PlayableMedia } from '@/lib/drillMedia'
import { embedUrl, parseVideoId } from '@/lib/drillVideo'
import {
  detailSections, contextChips, ProblemRef, Relative, MediaPresentation,
} from '@/lib/drillFinder'

export interface DrillDetailProps {
  drill: DrillRecord
  problems: ProblemRef[]
  relatives: Relative[]
  /** Best first. Each already described honestly by lib/drillFinder. */
  media: Array<{ playable: PlayableMedia; presentation: MediaPresentation }>
  isFavorite: boolean
  onClose: () => void
  onToggleFavorite: (id: string) => void
  onAddToPractice?: (d: DrillRecord) => void
  onOpenRelative: (d: DrillRecord) => void
  onMediaClick: (d: DrillRecord, m: PlayableMedia) => void
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function DrillDetail({
  drill, problems, relatives, media, isFavorite,
  onClose, onToggleFavorite, onAddToPractice, onOpenRelative, onMediaClick,
}: DrillDetailProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  // A different drill in the same dialog is a different drill. Without this,
  // opening a variation from the Variations row would leave the previous
  // drill's video expanded underneath the new one's instructions.
  useEffect(() => { setPlaying(null) }, [drill.id])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const body = document.body
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    // Focus the panel itself rather than the first control. Landing on the
    // close button reads "Close" as the first thing a screen reader announces
    // about a drill, which is exactly backwards.
    panel.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !panel.current) return

      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      body.style.overflow = previousOverflow
      // Back where they were. A coach who closes a drill should be looking at
      // the card they opened, not at the top of the page.
      opener?.focus?.()
    }
  }, [onClose])

  const sections = detailSections(drill)
  const chips = contextChips(drill)
  const mins = Number(drill.est_duration_minutes)
  const headingId = `drill-detail-${drill.id}`

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="bg-white w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto
                   rounded-t-2xl sm:rounded-2xl focus:outline-none"
      >
        {/* Header. The name first — not a video, not a channel. */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-200 px-4 sm:px-6 py-3 flex items-start gap-3 z-10">
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
              {drill.drill_name}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 flex flex-wrap gap-x-2">
              {drill.skill_category && <span>{drill.skill_category}</span>}
              {drill.difficulty_level && <span>· {drill.difficulty_level}</span>}
              {Number.isFinite(mins) && mins > 0 && <span>· {mins} min</span>}
              {drill.age_range && <span>· ages {drill.age_range}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-2 -m-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-5">
          {/* Actions, above the fold, because deciding to use a drill is the
              thing this screen exists to let a coach do. */}
          <div className="flex flex-wrap items-center gap-2">
            {onAddToPractice && (
              <button
                type="button"
                onClick={() => onAddToPractice(drill)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Plus size={15} /> Add to practice
              </button>
            )}
            <button
              type="button"
              onClick={() => drill.id && onToggleFavorite(drill.id)}
              aria-pressed={isFavorite}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isFavorite
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Star size={15} fill={isFavorite ? 'currentColor' : 'none'} />
              {isFavorite ? 'Saved' : 'Save'}
            </button>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map(c => (
                <span key={c.label} title={c.detail}
                      className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]">
                  {c.label}
                </span>
              ))}
            </div>
          )}

          {/* The written drill. */}
          {sections.map(s => (
            <section key={s.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {s.heading}
              </h3>
              {s.body && (
                <p className="mt-1 text-[15px] text-gray-800 leading-relaxed whitespace-pre-line">
                  {s.body}
                </p>
              )}
              {s.items && (
                <ul className="mt-1.5 space-y-1">
                  {s.items.map((item, i) => (
                    <li key={i} className="text-[15px] text-gray-800 leading-relaxed flex gap-2">
                      <span className="text-gray-300 mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* What this is mapped to fix. The curated taxonomy, not the free-text
              common_flaws_fixed column the old modal printed — 153 of the 154
              schedulable activities are mapped, and these are the labels the
              rest of the product diagnoses against. */}
          {problems.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Use it when
              </h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {problems.map(p => (
                  <span key={p.slug} className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-xs">
                    {p.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Variations. Only real family members, only labelled ones. */}
          {relatives.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Variations
              </h3>
              <ul className="mt-1.5 divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {relatives.map(r => (
                  <li key={r.drill.id}>
                    <button
                      type="button"
                      onClick={() => onOpenRelative(r.drill)}
                      className="w-full text-left px-3 py-2.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                    >
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {r.label}
                      </span>
                      <span className="block text-sm text-gray-900">{r.drill.drill_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Media. Last, optional, and described as what it is.
              Nothing renders at all when there is none — 14 of the 154
              schedulable activities have no media, and they are complete
              drills, not broken ones. */}
          {media.length > 0 && (
            <section className="pt-1 border-t border-gray-100">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-4">
                {media.length > 1 ? 'Supporting media' : 'Supporting video'}
              </h3>
              <ul className="mt-2 space-y-2">
                {media.map((m, i) => {
                  const id = m.playable.media_type === 'youtube' ? parseVideoId(m.playable.url) : null
                  const key = `${m.playable.url}-${i}`
                  return (
                    <li key={key} className="rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800">{m.presentation.label}</p>
                          {m.presentation.note && (
                            <p className="text-xs text-gray-500 mt-0.5">{m.presentation.note}</p>
                          )}
                        </div>
                        {id && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlaying(playing === key ? null : key)
                              if (playing !== key) onMediaClick(drill, m.playable)
                            }}
                            aria-expanded={playing === key}
                            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            <Play size={12} /> {playing === key ? 'Hide' : 'Play here'}
                          </button>
                        )}
                        <a
                          href={m.playable.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => onMediaClick(drill, m.playable)}
                          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          <ExternalLink size={12} /> Open
                        </a>
                      </div>

                      {/* Mounted on demand. An iframe per drill on open is a
                          third-party request a coach never asked for. */}
                      {playing === key && id && (
                        <div className="aspect-video bg-black rounded-b-lg overflow-hidden">
                          <iframe
                            src={embedUrl({ youtube_video_id: id, youtube_start_seconds: m.playable.start_seconds }) || ''}
                            title={`${drill.drill_name} — supporting video`}
                            className="w-full h-full"
                            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
