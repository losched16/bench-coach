'use client'

import { useState } from 'react'
import { Loader2, Route as RouteIcon, X, Check } from 'lucide-react'
import { useTracker } from '@/lib/tracking'
import { defaultSelection, practiceLink } from '@/lib/practicePlanLink'

// "Record this practice on players' plans."
//
// Shown only on a saved practice that was built from a Development Plan stage
// (migration 077). Nothing is recorded until the coach confirms: the list is
// explicit, players at the practice's stage are ticked, players at other
// stages are listed unticked, and anyone this practice is already recorded for
// is shown as done rather than offered again. Each ticked player gets one
// session on their plan through the same route the plan page uses, which reads
// the length, drills and date from the practice itself.

interface Row {
  id: string
  status: 'active' | 'paused' | 'completed'
  current_stage_number: number | null
  stage_total: number
  already_recorded?: boolean
  player: { id: string; name: string } | null
}

export function RecordPracticeToPlans({
  plan, teamId, canRecord, variant = 'link',
}: {
  plan: { id: string; pathway_slug?: string | null; pathway_stage_number?: number | null }
  teamId: string | null
  canRecord: boolean
  variant?: 'link' | 'button'
}) {
  const track = useTracker()
  const link = practiceLink(plan)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'saving' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<{ recorded: number; skipped: number; failed: number } | null>(null)

  if (!link || !teamId || !canRecord) return null

  const load = async () => {
    setOpen(true); setState('loading'); setMessage(null); setResult(null)
    try {
      const q = new URLSearchParams({ teamId, pathway: link.slug, practicePlanId: plan.id })
      const res = await fetch(`/api/player-pathways?${q}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not load the plans.')
      const list: Row[] = (d.pathways || []).filter((r: Row) => r.status !== 'completed')
      setRows(list)
      setPicked(defaultSelection(list, link.stageNumber))
      setState('ready')
    } catch (e: any) {
      setMessage(e?.message || 'Could not load the plans.'); setState('error')
    }
  }

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const record = async () => {
    setState('saving')
    let recorded = 0, skipped = 0, failed = 0
    for (const id of Array.from(picked)) {
      try {
        const res = await fetch(`/api/player-pathways/${id}/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'session', practicePlanId: plan.id }),
        })
        if (res.ok) recorded++
        else if (res.status === 409) skipped++
        else failed++
      } catch { failed++ }
    }
    track('practice_recorded_on_plans', {
      pathway_slug: link.slug, stage_number: link.stageNumber,
      offered: rows.length, selected: picked.size, recorded, skipped, failed,
    })
    setResult({ recorded, skipped, failed })
    setState('done')
  }

  const stageLabel = link.stageNumber ? `stage ${link.stageNumber}` : 'this plan'

  return (
    <>
      <button
        type="button"
        onClick={load}
        className={variant === 'button'
          ? 'flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50'
          : 'text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center'}
      >
        <RouteIcon size={16} className="mr-1" />
        Record on players&apos; plans
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Record this practice on players' plans">
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">Record this practice on players&apos; plans</h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  Built for {stageLabel}. Each ticked player gets one session on their plan, with this practice&apos;s length and drills.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {state === 'loading' && (
                <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} /> Loading plans…</p>
              )}
              {state === 'error' && <p className="text-sm text-red-700">{message}</p>}
              {(state === 'ready' || state === 'saving') && rows.length === 0 && (
                <p className="text-sm text-gray-600">No players on this team are on this plan right now.</p>
              )}
              {(state === 'ready' || state === 'saving') && rows.length > 0 && (
                <ul className="divide-y divide-gray-100">
                  {rows.map(r => {
                    const other = link.stageNumber != null && r.current_stage_number !== link.stageNumber
                    return (
                      <li key={r.id}>
                        <label className={`flex items-center gap-3 py-3 ${r.already_recorded ? 'opacity-60' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={!r.already_recorded && picked.has(r.id)}
                            disabled={r.already_recorded || state === 'saving'}
                            onChange={() => toggle(r.id)}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block font-medium text-gray-900 truncate">{r.player?.name || 'Player'}</span>
                            <span className="block text-xs text-gray-500">
                              {r.already_recorded
                                ? 'Already recorded'
                                : `Stage ${r.current_stage_number ?? '?'}${r.stage_total ? ` of ${r.stage_total}` : ''}`
                                  + (other ? ' · a different stage' : '')
                                  + (r.status === 'paused' ? ' · paused' : '')}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              {state === 'done' && result && (
                <div className="text-sm text-gray-800 space-y-1">
                  <p className="flex items-center gap-2 font-medium text-green-700">
                    <Check size={16} /> Recorded on {result.recorded} plan{result.recorded === 1 ? '' : 's'}.
                  </p>
                  {result.skipped > 0 && <p>{result.skipped} already had this practice recorded.</p>}
                  {result.failed > 0 && <p className="text-red-700">{result.failed} could not be recorded. Try again from the player&apos;s plan.</p>}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
              {state === 'done' ? (
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Done</button>
              ) : (
                <>
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-700">Cancel</button>
                  <button
                    type="button"
                    onClick={record}
                    disabled={state !== 'ready' || picked.size === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {state === 'saving' && <Loader2 className="animate-spin" size={16} />}
                    Record for {picked.size} player{picked.size === 1 ? '' : 's'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
