'use client'

import { useState } from 'react'
import { Play, Wrench, Check, X, RefreshCw, Loader2, RotateCcw, Shuffle } from 'lucide-react'
import { DrillOptions, OptionDrill } from './DrillOptions'

// Judging the drills before they become the plan.
//
// A coach reads a suggested drill and knows within two seconds whether it's
// useful: they're already running it, or it needs a net they don't own, or the
// kid is well past it. That judgement was being thrown away — the drills were
// saved the moment the analysis finished, and the only recourse was replacing
// the whole set afterwards.
//
// Rejections are kept rather than just filtered, so a refresh can't hand back
// something already turned down.

export interface ReviewDrill {
  id: string
  drill_name: string
  description?: string | null
  youtube_video_id?: string | null
  youtube_url?: string | null
  channel?: string | null
  difficulty_level?: string | null
  equipment_needed?: string[] | null
  reps?: string | null
  frequency?: string | null
}

export type DrillVerdict = 'keep' | 'already_doing' | 'not_this'

interface Props {
  drills: ReviewDrill[]
  verdicts: Record<string, DrillVerdict>
  onVerdict: (drillId: string, verdict: DrillVerdict) => void
  onRefresh?: (reason: string) => Promise<void> | void
  refreshing?: boolean
  // Alternatives for one slot. Swapping the whole set to change one drill is
  // how a coach loses the two they liked.
  onOptions?: (drillId: string) => Promise<OptionDrill[]>
  onPick?: (replaceDrillId: string, chosen: OptionDrill) => void
}

const REJECTION_LABEL: Record<string, string> = {
  already_doing: "Already doing this",
  not_this: 'Not this one',
}

export function DrillReview({
  drills, verdicts, onVerdict, onRefresh, refreshing, onOptions, onPick,
}: Props) {
  const [askingWhy, setAskingWhy] = useState(false)
  const [reason, setReason] = useState('')
  const [optionsFor, setOptionsFor] = useState<string | null>(null)
  const [options, setOptions] = useState<OptionDrill[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  const showOptions = async (drillId: string) => {
    if (!onOptions) return
    setOptionsFor(drillId)
    setOptions([])
    setLoadingOptions(true)
    try {
      setOptions(await onOptions(drillId))
    } finally {
      setLoadingOptions(false)
    }
  }

  if (!drills.length) {
    return (
      <p className="text-sm text-gray-500">
        No drills matched this one. The priority still stands on its own — you can add drills later.
      </p>
    )
  }

  const kept = drills.filter(d => (verdicts[d.id] || 'keep') === 'keep').length

  return (
    <div className="space-y-3">
      {drills.map(d => {
        const verdict = verdicts[d.id] || 'keep'
        const rejected = verdict !== 'keep'
        return (
          <div
            key={d.id}
            className={`p-3 rounded-lg border transition-colors ${
              rejected ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-start gap-2 flex-wrap">
              <h5 className={`font-medium text-sm ${rejected ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                {d.drill_name}
              </h5>
              {d.difficulty_level && !rejected && (
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">
                  {d.difficulty_level}
                </span>
              )}
              {rejected && (
                <span className="text-xs px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">
                  {REJECTION_LABEL[verdict]}
                </span>
              )}
            </div>

            {!rejected && (
              <>
                {d.description && <p className="text-sm text-gray-600 mt-1">{d.description}</p>}

                {(d.reps || d.frequency) && (
                  <p className="text-xs text-gray-700 mt-1.5">
                    {[d.reps, d.frequency].filter(Boolean).join(' · ')}
                  </p>
                )}

                {d.equipment_needed?.length ? (
                  <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                    <Wrench size={11} /> {d.equipment_needed.join(', ')}
                  </p>
                ) : null}

                {(d.youtube_url || d.youtube_video_id) && (
                  <a
                    href={d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 mt-2"
                  >
                    <Play size={13} /> Watch{d.channel ? ` · ${d.channel}` : ''}
                  </a>
                )}
              </>
            )}

            {optionsFor === d.id && (
              <DrillOptions
                options={options}
                loading={loadingOptions}
                replacingName={d.drill_name}
                onPick={o => { onPick?.(d.id, o); setOptionsFor(null) }}
                onCancel={() => setOptionsFor(null)}
              />
            )}

            <div className="flex flex-wrap gap-3 mt-2.5 pt-2.5 border-t border-gray-100">
              {rejected ? (
                <button
                  onClick={() => onVerdict(d.id, 'keep')}
                  className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                >
                  <RotateCcw size={11} /> Put it back
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onVerdict(d.id, 'already_doing')}
                    className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
                  >
                    <Check size={11} /> Already doing this
                  </button>
                  <button
                    onClick={() => onVerdict(d.id, 'not_this')}
                    className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
                  >
                    <X size={11} /> Not this one
                  </button>
                  {onOptions && (
                    <button
                      onClick={() => showOptions(d.id)}
                      className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
                    >
                      <Shuffle size={11} /> Other options
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}

      {onRefresh && (
        askingWhy ? (
          <div className="p-3 border border-gray-200 rounded-lg bg-white">
            <label className="block text-sm font-medium text-gray-800 mb-1">
              What&apos;s wrong with these? (optional)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              &quot;No net at home&quot;, &quot;too advanced&quot;, &quot;we did these all spring&quot; — it
              gets used to pick the replacements.
            </p>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="Optional"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={async () => { await onRefresh(reason.trim()); setAskingWhy(false); setReason('') }}
                disabled={refreshing}
                className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {refreshing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                {refreshing ? 'Finding drills…' : 'Show me different ones'}
              </button>
              <button
                onClick={() => { setAskingWhy(false); setReason('') }}
                disabled={refreshing}
                className="px-3 py-1.5 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAskingWhy(true)}
            className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} /> Show me different drills
          </button>
        )
      )}

      {kept === 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          You&apos;ve set all of them aside. That&apos;s fine — the priority is the deliverable and you
          can attack it your own way. Refresh for different ones, or make it the priority as it stands.
        </p>
      )}
    </div>
  )
}
