'use client'

import { RefreshCw } from 'lucide-react'
import { DrillVideo, DrillVideoLookup } from './DrillVideo'
import { SaveDrillButton } from './SaveDrillButton'

// One block of a practice plan, rendered in full.
//
// This exists because the draft preview and the saved plan drifted: the saved
// view rendered fifteen fields and the draft rendered three, so a coach
// reviewing a plan before saving it read a title, a line of description and a
// duration and concluded the plan was thin. It was not thin. The setup, the
// numbered instructions, the cues, the mistakes and the video were all there
// and none of them were on screen.
//
// Two call sites, one component. They cannot disagree again.

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
}

export function PracticeBlock({
  block, idx, onSwap, drillResources = [],
  coachId = null, favorites, onFavoritesChanged,
}: Props) {
  return (
      <div className="mb-5 last:mb-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Block Header */}
        <div className="px-5 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                block.type === 'warmup' ? 'bg-yellow-100 text-yellow-700' :
                block.type === 'drill' || block.type === 'station' ? 'bg-blue-100 text-blue-700' :
                block.type === 'game' ? 'bg-green-100 text-green-700' :
                block.type === 'cooldown' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {idx + 1}
              </span>
              <h4 className="font-semibold text-gray-900 text-base">{block.title}</h4>
            </div>
            <div className="flex items-center gap-2">
              {onSwap && (
                <button
                  onClick={onSwap}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Swap this drill"
                >
                  <RefreshCw size={15} />
                </button>
              )}
              <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200">{block.minutes} min</span>
            </div>
          </div>
          {block.description && (
            <p className="text-sm text-gray-600 mt-2 ml-11">{block.description}</p>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
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

          {/* Setup */}
          {block.setup && (
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

          {/* Embedded Drill Video — prefer AI-provided youtube_video_id, fallback to fuzzy match */}
          {block.youtube_video_id ? (
            <DrillVideo
              drillName={block.drill_name || block.title}
              youtubeVideoId={block.youtube_video_id}
              channel={block.youtube_channel}
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
          )}

          {/* Last in the block on purpose: they decide whether they like a
              drill after reading how it runs, not before. */}
          {favorites && onFavoritesChanged && (
            <div className="pt-1">
              <SaveDrillButton
                block={block}
                coachId={coachId}
                favorites={favorites}
                onChanged={onFavoritesChanged}
              />
            </div>
          )}
        </div>
      </div>
  )
}
