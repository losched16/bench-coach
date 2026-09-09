'use client'

import { useState } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, Video } from 'lucide-react'
import { DrillVideo, DrillVideoLookup } from './DrillVideo'
import { SaveDrillButton } from './SaveDrillButton'
import { isStationGroup } from '@/lib/practicePlan'

// One block of a practice plan.
//
// This exists because the draft preview and the saved plan drifted: the saved
// view rendered fifteen fields and the draft rendered three, so a coach
// reviewing a plan before saving it read a title, a line of description and a
// duration and concluded the plan was thin. It was not thin. The setup, the
// numbered instructions, the cues, the mistakes and the video were all there
// and none of them were on screen.
//
// Two call sites, one component. They cannot disagree again.
//
// OVERVIEW FIRST, DETAIL ON DEMAND
//
// Fifteen fields per block is the right amount of detail and the wrong
// default. A coach reviewing a generated plan wants to see the whole practice
// at a glance — time, activity, minutes, what skill it serves — and open the
// block they have a question about. So a block is a compact row until it is
// tapped. Nothing is removed: the expanded state is the full block it always
// was. The parent decides the default (a fresh draft opens collapsed) and can
// drive expand-all / collapse-all through `open`.
//
// A STATION ROTATION IS ONE BLOCK
//
// Three stations running at once are one row on the clock, not three. The
// parent row shows the rotation (groups, minutes each, elapsed); expanding it
// lists the stations, and each station opens to its own detail. Rendering
// them as three sequential blocks would triple the apparent length of the
// practice and hide the fact that every kid does all three.

interface Props {
  block: any
  idx: number
  // Swap is only offered on a saved plan — a draft has a rebuild box instead,
  // which is a better tool for the same job at that moment.
  onSwap?: () => void
  drillResources?: any[]
  // Saving a drill happens here, in the moment a coach decides they like it,
  // rather than only on a library page nobody browses.
  coachId?: string | null
  favorites?: Set<string>
  onFavoritesChanged?: () => void
  /** Wall-clock or elapsed range for the row, from lib/practicePlan.scheduleRows. */
  timeLabel?: string
  /** Controlled open state. Undefined leaves the block to manage itself. */
  open?: boolean
  onToggle?: (open: boolean) => void
  /** Start collapsed (the review default) or expanded (the old behaviour). */
  defaultOpen?: boolean
  /** Station children render smaller and without their own swap/save. */
  nested?: boolean
}

const TYPE_LABEL: Record<string, string> = {
  warmup: 'Warm-up', drill: 'Drill', station: 'Stations', game: 'Game', cooldown: 'Cool-down',
}

function typeBadge(type: string): string {
  return type === 'warmup' ? 'bg-yellow-100 text-yellow-700' :
    type === 'drill' ? 'bg-blue-100 text-blue-700' :
    type === 'station' ? 'bg-indigo-100 text-indigo-700' :
    type === 'game' ? 'bg-green-100 text-green-700' :
    type === 'cooldown' ? 'bg-purple-100 text-purple-700' :
    'bg-gray-100 text-gray-700'
}

function skillLabel(s: string): string {
  const t = String(s || '')
  if (t.toLowerCase() === 'game iq') return 'Game IQ'
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function PracticeBlock({
  block, idx, onSwap, drillResources = [],
  coachId = null, favorites, onFavoritesChanged,
  timeLabel, open, onToggle, defaultOpen = false, nested = false,
}: Props) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen)
  const isOpen = open ?? selfOpen
  const toggle = () => {
    const next = !isOpen
    if (open === undefined) setSelfOpen(next)
    onToggle?.(next)
  }

  const station = isStationGroup(block)
  const type = station ? 'station' : String(block.type || 'drill')
  const stations: any[] = station ? block.stations : []
  const skills: string[] = Array.isArray(block.skills) ? block.skills : []
  const groups = station ? (Number(block.groups) || stations.length) : 0
  const rotation = station ? (Number(block.rotation_minutes) || 0) : 0
  const hasDetail = Boolean(
    block.watch_for || block.setup || block.detailed_instructions ||
    block.coaching_cues?.length || block.common_mistakes?.length || block.equipment?.length ||
    block.drill_variations || block.adjustments || block.success_indicators?.length ||
    block.youtube_video_id || station
  )
  const rowId = `practice-block-${idx}${nested ? '-station' : ''}`

  return (
    <div
      className={`${nested ? 'mb-2 last:mb-0 border-gray-200' : 'mb-3 last:mb-0 border-gray-200'} bg-white rounded-lg border overflow-hidden`}
      data-testid={station ? 'station-block' : 'practice-block'}
      data-open={isOpen ? 'true' : 'false'}
    >
      {/* Collapsed row: everything a coach needs to scan the practice, and
          nothing that needs a second line on a phone. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={rowId}
        className={`w-full text-left ${nested ? 'px-3 py-2' : 'px-3 sm:px-4 py-3'} ${isOpen ? 'bg-gradient-to-r from-blue-50 to-white border-b border-gray-100' : 'hover:bg-gray-50'} transition-colors`}
      >
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span className={`inline-flex items-center justify-center shrink-0 ${nested ? 'w-6 h-6 text-[11px]' : 'w-8 h-8 text-xs'} rounded-full font-bold ${typeBadge(type)}`}>
            {nested ? String.fromCharCode(65 + idx) : idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                {timeLabel && (
                  <span className="block text-[11px] tabular-nums text-gray-500 leading-none mb-0.5">{timeLabel}</span>
                )}
                <h4 className={`font-semibold text-gray-900 ${nested ? 'text-sm' : 'text-[15px] sm:text-base'} leading-snug`}>
                  {block.title}
                </h4>
              </div>
              <span className="shrink-0 text-sm font-medium text-gray-600 tabular-nums whitespace-nowrap">
                {block.minutes} min
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-gray-600">
              <span className="uppercase tracking-wide font-medium text-gray-500">{TYPE_LABEL[type] || type}</span>
              {skills.map(s => (
                <span key={s} className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-700">
                  {skillLabel(s)}
                </span>
              ))}
              {station && (
                <span className="text-gray-500">
                  · {groups} groups · {stations.length} stations{rotation ? ` · ${rotation} min each` : ''}
                </span>
              )}
            </div>
          </div>
          <span className="shrink-0 mt-1 text-gray-400">
            {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>
        </div>
      </button>

      {isOpen && (
        <div id={rowId} className={`${nested ? 'px-3 py-3' : 'px-3 sm:px-5 py-4'} space-y-4`}>
          <div className="flex items-start justify-between gap-3">
            {block.description && (
              <p className="text-sm text-gray-600">{block.description}</p>
            )}
            {onSwap && !nested && (
              <button
                onClick={onSwap}
                className="shrink-0 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Swap this drill"
              >
                <RefreshCw size={15} />
              </button>
            )}
          </div>

          {/* The station overview: one line per station, each openable. The
              parent's own setup (groups, rotation, who goes where) sits above
              them because it is the thing the coach reads first on the field. */}
          {station && (
            <div className="space-y-2" data-testid="station-children">
              {block.setup && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">Rotation</span>
                  <p className="text-sm text-indigo-900 mt-1">{block.setup}</p>
                </div>
              )}
              {stations.map((s: any, i: number) => (
                <PracticeBlock
                  key={i}
                  block={{ ...s, minutes: s.minutes || rotation }}
                  idx={i}
                  drillResources={drillResources}
                  coachId={coachId}
                  favorites={favorites}
                  onFavoritesChanged={onFavoritesChanged}
                  nested
                />
              ))}
            </div>
          )}

          {/* The thing an experienced coach sees from the side that a
              first-timer walks past. Highest-value sentence in the block, so
              it sits above the instructions rather than under them. */}
          {block.watch_for && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5">
              <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide mb-1">
                What to watch for
              </p>
              <p className="text-sm text-amber-900 leading-relaxed">{block.watch_for}</p>
            </div>
          )}
          {/* Equipment */}
          {block.equipment && block.equipment.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {block.equipment.map((item: string, i: number) => (
                <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                  {item}
                </span>
              ))}
            </div>
          )}

          {/* Setup (a station parent's setup is its rotation, shown above) */}
          {block.setup && !station && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Setup</span>
              <p className="text-sm text-amber-900 mt-1">{block.setup}</p>
            </div>
          )}

          {/* Detailed Instructions */}
          {block.detailed_instructions && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">How to Run This Drill</span>
              <div className="text-sm text-blue-900 mt-2 whitespace-pre-line leading-relaxed">
                {block.detailed_instructions}
              </div>
            </div>
          )}

          {/* Coaching Cues */}
          {block.coaching_cues && block.coaching_cues.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Say This Out Loud</span>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {block.coaching_cues.map((cue: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <span className="text-green-600 mt-0.5 shrink-0">&#x1f4ac;</span>
                    <span className="text-sm text-green-900 italic">"{cue}"</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Common Mistakes */}
          {block.common_mistakes && block.common_mistakes.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Watch For</span>
              <ul className="mt-2 space-y-1.5">
                {block.common_mistakes.map((mistake: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-red-500 mt-0.5 shrink-0">&#x26a0;&#xfe0f;</span>
                    <span>{mistake}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Drill Variations */}
          {block.drill_variations && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide">Adjustments</span>
              <p className="text-sm text-purple-900 mt-1">{block.drill_variations}</p>
            </div>
          )}

          {/* Adjustments (legacy field) */}
          {!block.drill_variations && block.adjustments && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide">Adjustments</span>
              <p className="text-sm text-purple-900 mt-1">{block.adjustments}</p>
            </div>
          )}

          {/* Success Indicators */}
          {block.success_indicators && block.success_indicators.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">You're Doing It Right When...</span>
              <ul className="mt-2 space-y-1">
                {block.success_indicators.map((indicator: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-green-500 mt-0.5 shrink-0">&#x2705;</span>
                    <span>{indicator}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Embedded Drill Video — prefer AI-provided youtube_video_id, fallback to fuzzy match.
              A station parent has no video of its own; its stations do. */}
          {/* A link the coach pasted that is not YouTube — their own game
              film, a Hudl clip, a Drive upload. Not embedded on purpose: an
              iframe to an arbitrary host is a privacy and mixed-content
              problem and most of these hosts refuse framing anyway. A
              tap-through beats refusing the link. */}
          {!station && !block.youtube_video_id && block.video_url && (
            <a
              href={block.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              <Video className="w-4 h-4" />
              Watch the video for this block
            </a>
          )}

          {!station && (block.youtube_video_id ? (
            <DrillVideo
              drillName={block.drill_name || block.title}
              youtubeVideoId={block.youtube_video_id}
              channel={block.youtube_channel}
              // Where the coach said this drill starts. Dropped before this,
              // so a block curated to 4:12 still opened on the compilation's
              // introduction — the exact failure the timestamp exists to stop.
              startSeconds={block.youtube_start_seconds ?? undefined}
              compact={true}
              autoExpand={false}
            />
          ) : (
            <DrillVideoLookup
              drillName={block.title}
              drillResources={drillResources}
              compact={true}
              autoExpand={false}
            />
          ))}

          {/* Last in the block on purpose: they decide whether they like a
              drill after reading how it runs, not before. */}
          {favorites && onFavoritesChanged && !station && (
            <div className="pt-1">
              <SaveDrillButton
                block={block}
                coachId={coachId}
                favorites={favorites}
                onChanged={onFavoritesChanged}
              />
            </div>
          )}

          {!hasDetail && !block.description && (
            <p className="text-sm text-gray-500">The detail for this block is still being written.</p>
          )}
        </div>
      )}
    </div>
  )
}
