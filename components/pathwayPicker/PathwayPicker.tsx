'use client'

// The pathway picker and stage navigator, inside the Generate Practice modal.
//
// Presentational on purpose. It owns no data loading and no fetch — the page
// hands it pathways, the selected pathway's stages, and callbacks. That is the
// same split Drill Finder uses, and it is what lets the acceptance harness
// mount the real component instead of a copy of it.
//
// WHAT THIS IS NOT
//
// Not a planner. It chooses what the team is developing and which stage of it
// they are on, and stops there. Duration, players, coaches, space, kit and
// whether anything actually fits belong to the practice form and the planner
// underneath it, and this component must not appear to answer them.

import { useEffect, useRef } from 'react'
import { ChevronRight, ChevronLeft, X, Target, AlertCircle, RotateCcw } from 'lucide-react'
import type { LoadedPathway, PathwayStage } from '@/lib/developmentPathways'
import { orderedStages } from '@/lib/developmentPathways'
import {
  PathwayOption, stageCountLabel, stageHeading, stageDrillCount,
  stageBreadth, neighbours,
} from '@/lib/pathwayUi'

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface PathwayPickerProps {
  /** Published pathways. Empty with state 'ready' means genuinely none. */
  pathways: PathwayOption[]
  state: LoadState
  onRetry: () => void

  selectedSlug: string | null
  /** Stages for the selected pathway. Null while stageState is not 'ready'. */
  loaded: LoadedPathway | null
  stageState: LoadState
  stageNumber: number | null

  onSelectPathway: (slug: string | null) => void
  onSelectStage: (stageNumber: number) => void
  onTrack?: (event: string, metadata?: any) => void
}

export function PathwayPicker({
  pathways, state, onRetry,
  selectedSlug, loaded, stageState, stageNumber,
  onSelectPathway, onSelectStage, onTrack,
}: PathwayPickerProps) {
  const track = (event: string, metadata?: any) => { if (onTrack) onTrack(event, metadata) }
  const stages = orderedStages(loaded)
  const stage = stages.find(s => s.stage_number === stageNumber) || null
  const { previous, next } = neighbours(loaded, stageNumber)

  // ── nothing chosen yet ────────────────────────────────────────────────────

  if (!selectedSlug) {
    return (
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">
          Working on something specific? <span className="font-normal text-gray-500">(optional)</span>
        </p>

        {state === 'loading' && (
          <div className="border border-gray-200 rounded-lg p-3 text-sm text-gray-500">
            Loading development pathways…
          </div>
        )}

        {/* A load that failed and a world with no pathways look identical on
            screen unless we say which happened. Saying "no pathways exist"
            when the request errored teaches the coach the feature is empty. */}
        {state === 'error' && (
          <div className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium">Couldn&apos;t load the development pathways.</p>
              <p className="mt-0.5">
                You can still build the practice normally — this part is optional.
              </p>
              <button
                type="button"
                onClick={() => { track('pathway_load_retried'); onRetry() }}
                className="mt-2 inline-flex items-center gap-1.5 text-amber-900 font-medium underline"
              >
                <RotateCcw size={14} /> Try again
              </button>
            </div>
          </div>
        )}

        {state === 'ready' && pathways.length === 0 && (
          <div className="border border-gray-200 rounded-lg p-3 text-sm text-gray-500">
            No development pathways are published yet.
          </div>
        )}

        {state === 'ready' && pathways.length > 0 && (
          <div className="space-y-2">
            {pathways.map(p => (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  track('pathway_selected', { pathway_slug: p.slug, stage_count: p.stageCount })
                  onSelectPathway(p.slug)
                }}
                className="w-full text-left border-2 border-gray-200 hover:border-blue-400 rounded-lg p-3 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <Target size={16} className="shrink-0 mt-0.5 text-blue-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 break-words">{p.name}</p>
                    {p.summary && (
                      <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 break-words">
                        {p.summary}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      <span className="capitalize">{p.skillCategory || 'general'}</span>
                      {' · '}{stageCountLabel(p.stageCount)}
                    </p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 mt-0.5 text-gray-400" />
                </div>
              </button>
            ))}
            <p className="text-xs text-gray-500">
              A pathway shapes part of the practice. Everything else — how long you have,
              how many players and coaches, what space and kit — still decides what fits.
            </p>
          </div>
        )}
      </div>
    )
  }

  // ── a pathway is chosen: the stage navigator ──────────────────────────────

  const chosen = pathways.find(p => p.slug === selectedSlug)
  const count = stageDrillCount(loaded, stage)
  const breadth = stage ? stageBreadth(count) : null

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="block text-sm font-medium text-gray-700">Development focus</p>
        <button
          type="button"
          onClick={() => {
            track('pathway_cleared', { pathway_slug: selectedSlug })
            onSelectPathway(null)
          }}
          // px-2 py-2 rather than bare text: at 390px this is the control a
          // coach reaches for one-handed to get back to normal planning, and
          // the acceptance run measured it at under 32px tall without padding.
          // -mr-2 keeps it optically aligned with the edge it used to sit on.
          className="-mr-2 px-2 py-2 text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 shrink-0"
        >
          <X size={12} /> Clear
        </button>
      </div>

      <div className="border-2 border-blue-600 bg-blue-50 rounded-lg p-3">
        <p className="font-medium text-blue-900 break-words">
          {chosen?.name || selectedSlug}
        </p>

        {stageState === 'loading' && (
          <p className="text-sm text-blue-800 mt-1">Loading stages…</p>
        )}

        {stageState === 'error' && (
          <div className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
            <p className="font-medium">Couldn&apos;t load the stages for this pathway.</p>
            <button
              type="button"
              onClick={() => { track('pathway_stage_load_retried', { pathway_slug: selectedSlug }); onRetry() }}
              className="mt-1 inline-flex items-center gap-1.5 font-medium underline"
            >
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        )}

        {stageState === 'ready' && stages.length === 0 && (
          <p className="text-sm text-blue-800 mt-1">
            This pathway has no stages yet. Pick another, or clear it and build normally.
          </p>
        )}

        {stageState === 'ready' && stage && (
          <>
            <p className="text-xs text-blue-700 mt-1">
              {stageHeading(stage.stage_number, stages.length)}
            </p>
            <p className="font-medium text-blue-900 mt-1 break-words">{stage.name}</p>

            <p className="text-sm text-blue-900 mt-2 break-words">{stage.objective}</p>

            {stage.mastery_signals?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-blue-800">What tells you it landed</p>
                <ul className="mt-1 space-y-0.5">
                  {stage.mastery_signals.map((m, i) => (
                    <li key={i} className="text-xs text-blue-900 flex gap-1.5">
                      <span aria-hidden="true" className="shrink-0">·</span>
                      <span className="break-words">{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* A stage with one or two drills is usable and is not an error.
                Say what it means for the practice, not what our audit calls it. */}
            {breadth && (
              <p className="text-xs text-blue-800 mt-2 border-t border-blue-200 pt-2 break-words">
                <span className="font-medium">{breadth.label}.</span> {breadth.detail}
              </p>
            )}

            {/* Previous / next, plus a direct jump. No completion, no
                advancement — the coach is choosing where to work today. */}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                disabled={!previous}
                aria-label={previous ? `Previous stage: ${previous.name}` : 'No previous stage'}
                onClick={() => {
                  if (!previous) return
                  track('pathway_stage_selected', {
                    pathway_slug: selectedSlug, stage_number: previous.stage_number,
                    stage_key: previous.stage_key, via: 'previous',
                  })
                  onSelectStage(previous.stage_number)
                }}
                className="flex-1 min-w-0 inline-flex items-center justify-center gap-1 px-2 py-2 rounded-lg border border-blue-300 bg-white text-sm text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} className="shrink-0" />
                <span className="truncate">{previous ? previous.name : 'First stage'}</span>
              </button>
              <button
                type="button"
                disabled={!next}
                aria-label={next ? `Next stage: ${next.name}` : 'No next stage'}
                onClick={() => {
                  if (!next) return
                  track('pathway_stage_selected', {
                    pathway_slug: selectedSlug, stage_number: next.stage_number,
                    stage_key: next.stage_key, via: 'next',
                  })
                  onSelectStage(next.stage_number)
                }}
                className="flex-1 min-w-0 inline-flex items-center justify-center gap-1 px-2 py-2 rounded-lg border border-blue-300 bg-white text-sm text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="truncate">{next ? next.name : 'Last stage'}</span>
                <ChevronRight size={14} className="shrink-0" />
              </button>
            </div>

            <label className="block text-xs font-medium text-blue-800 mt-3 mb-1" htmlFor="pathway-stage-jump">
              Or go straight to a stage
            </label>
            <select
              id="pathway-stage-jump"
              value={stage.stage_number}
              onChange={e => {
                const n = Number(e.target.value)
                const s = stages.find(x => x.stage_number === n)
                track('pathway_stage_selected', {
                  pathway_slug: selectedSlug, stage_number: n,
                  stage_key: s?.stage_key, via: 'jump',
                })
                onSelectStage(n)
              }}
              className="w-full px-3 py-2 border border-blue-300 rounded-lg bg-white text-sm text-blue-900"
            >
              {stages.map(s => (
                <option key={s.stage_key} value={s.stage_number}>
                  {s.stage_number}. {s.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The pathway context on a generated plan.
 *
 * Fed by the `pathway` NDJSON message the route has been sending since Phase
 * 2E and the page has been dropping. Coach-facing fields only — the summary
 * carries no ids, no ranks and no internal status, and this renders exactly
 * what it is given.
 */
export interface PathwayContext {
  pathway: string
  stage: string
  objective: string
  drills?: string[]
  masterySignals?: string[]
  nextStage?: string | null
  warnings?: string[]
}

export function PathwayContextCard({ context }: { context: PathwayContext | null }) {
  if (!context) return null
  return (
    <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
      <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">
        Development focus
      </p>
      <p className="font-medium text-blue-900 mt-0.5 break-words">{context.pathway}</p>
      <p className="text-sm text-blue-900 break-words">{context.stage}</p>
      <p className="text-sm text-blue-900 mt-2 break-words">{context.objective}</p>

      {context.masterySignals && context.masterySignals.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-blue-800">What tells you it landed</p>
          <ul className="mt-1 space-y-0.5">
            {context.masterySignals.map((m, i) => (
              <li key={i} className="text-xs text-blue-900 flex gap-1.5">
                <span aria-hidden="true" className="shrink-0">·</span>
                <span className="break-words">{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The planner's own warnings, already written for a coach. The commonest
          is that nothing in the stage fits tonight, which the coach needs to
          read before they run the practice rather than after. */}
      {context.warnings && context.warnings.length > 0 && (
        <div className="mt-2 border-t border-blue-200 pt-2">
          {context.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-900 flex gap-1.5">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span className="break-words">{w}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
