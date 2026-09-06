'use client'

// Starting a report from what the coach already recorded.
//
// The list is everything BenchCoach has on this player for this season, dated,
// grouped by what it is. The coach ticks what belongs in the report and says
// where; then, per section, either drops it in as their own dated notes or
// asks BenchCoach for a first draft written from those items and nothing else.
//
// What this deliberately is not: automatic. Priorities the coach set are
// pre-ticked because they are the coach's own explicit decisions about this
// player. Everything else waits to be chosen. Traits are shown, marked private,
// and never pre-ticked. Roster ratings are shown and cannot be chosen — the
// report does not rank children.
//
// Development areas are seeded from priorities only, because a priority
// already names a catalogued problem and so arrives with its drills ready.
// Other items sent to Development become notes above the priorities, for the
// coach to fold in on the next step.

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Sparkles, Check, RotateCcw, X, ListPlus, Lock, ChevronDown, ChevronUp, History,
} from 'lucide-react'
import { useTracker } from '@/lib/tracking'
import {
  itemsToNotes, priorityToFocusArea,
  type SourceBundle, type SourceItem, type SourceKind, type SourceTarget, type FocusAreaSeed,
} from '@/lib/playerReportSources'
import { formatReportDate } from '@/lib/playerReports'

interface SourcePickerProps {
  reportId: string
  playerFirstName: string
  /** Room left on the Development step. Priorities beyond it are added as notes. */
  remainingFocusAreas: number
  onAddNotes: (target: SourceTarget, notes: string) => void
  onAddFocusAreas: (seeds: FocusAreaSeed[]) => void
  onUseDraft: (target: 'strengths' | 'closing', text: string) => void
  disabled?: boolean
}

const GROUPS: Array<{ kind: SourceKind; title: string; hint?: string }> = [
  { kind: 'priority', title: 'Priorities you set', hint: 'Active ones are ticked for Development, resolved ones for Strengths.' },
  { kind: 'note', title: 'Player notes' },
  { kind: 'observation', title: 'Observations' },
  { kind: 'entry', title: 'Games, practices and lessons' },
  { kind: 'measurement', title: 'Measurements', hint: 'First reading to latest, as recorded.' },
  { kind: 'trait', title: 'Traits', hint: 'Private notes. Nothing here is included unless you choose it.' },
]

const TARGET_LABEL: Record<SourceTarget, string> = {
  strengths: 'Strengths', development: 'Development', closing: 'Closing comment',
}

interface DraftState {
  loading: boolean
  suggestion: string | null
  sources: SourceItem[]
  message: string | null
  showSources: boolean
}

export function SourcePicker({
  reportId, playerFirstName, remainingFocusAreas,
  onAddNotes, onAddFocusAreas, onUseDraft, disabled = false,
}: SourcePickerProps) {
  const track = useTracker()
  const [bundle, setBundle] = useState<SourceBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allSeasons, setAllSeasons] = useState(false)
  // id -> destination. Present means ticked.
  const [selected, setSelected] = useState<Record<string, SourceTarget>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ trait: true })
  const [drafts, setDrafts] = useState<Partial<Record<SourceTarget, DraftState>>>({})
  const [added, setAdded] = useState<Partial<Record<SourceTarget, string>>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/player-reports/${reportId}/sources${allSeasons ? '?all=1' : ''}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(data?.error || 'Could not load what has been recorded.'); return }
        setBundle(data)
        // Pre-tick only what the server marked — the coach's own priorities.
        const pre: Record<string, SourceTarget> = {}
        for (const it of (data.items || []) as SourceItem[]) {
          if (it.preselected && it.suggestedTarget) pre[it.id] = it.suggestedTarget
        }
        setSelected(prev => ({ ...pre, ...prev }))
      } catch {
        if (!cancelled) setError('Could not load what has been recorded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reportId, allSeasons])

  const byKind = useMemo(() => {
    const m = new Map<SourceKind, SourceItem[]>()
    for (const it of bundle?.items || []) {
      if (!m.has(it.kind)) m.set(it.kind, [])
      m.get(it.kind)!.push(it)
    }
    return m
  }, [bundle])

  const itemById = useMemo(
    () => new Map((bundle?.items || []).map(it => [it.id, it])), [bundle]
  )

  const selectedFor = (target: SourceTarget): SourceItem[] =>
    Object.entries(selected)
      .filter(([, t]) => t === target)
      .map(([id]) => itemById.get(id))
      .filter((x): x is SourceItem => Boolean(x))

  const toggle = (it: SourceItem) => {
    setSelected(prev => {
      const next = { ...prev }
      if (next[it.id]) delete next[it.id]
      else next[it.id] = it.suggestedTarget || 'strengths'
      return next
    })
  }

  const retarget = (id: string, target: SourceTarget) =>
    setSelected(prev => ({ ...prev, [id]: target }))

  // ---- the three ways out --------------------------------------------------

  const addAsNotes = (target: SourceTarget) => {
    const items = selectedFor(target)
    if (!items.length) return
    if (target === 'development') {
      // Priorities become development areas; everything else becomes notes
      // above them. A priority beyond the room left is added as a note too,
      // rather than silently dropped.
      const seeds = items.map(priorityToFocusArea).filter((s): s is FocusAreaSeed => Boolean(s))
      const asAreas = seeds.slice(0, Math.max(0, remainingFocusAreas))
      const overflow = items.filter(it => it.kind !== 'priority' || !asAreas.some(s => s.coachNotes === it.text))
      if (asAreas.length) onAddFocusAreas(asAreas)
      if (overflow.length) onAddNotes('development', itemsToNotes(overflow))
      track('player_report_sources_used', { reportId, target, mode: 'areas', count: items.length })
      setAdded(a => ({ ...a, development: `${asAreas.length} development area${asAreas.length === 1 ? '' : 's'}${overflow.length ? ` + ${overflow.length} note${overflow.length === 1 ? '' : 's'}` : ''} added` }))
      return
    }
    onAddNotes(target, itemsToNotes(items))
    track('player_report_sources_used', { reportId, target, mode: 'notes', count: items.length })
    setAdded(a => ({ ...a, [target]: `${items.length} item${items.length === 1 ? '' : 's'} added as notes` }))
  }

  const draft = async (target: 'strengths' | 'closing') => {
    const items = selectedFor(target)
    if (!items.length) return
    setDrafts(d => ({ ...d, [target]: { loading: true, suggestion: null, sources: items, message: null, showSources: false } }))
    try {
      const res = await fetch('/api/player-reports/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId, kind: target,
          items: items.map(it => ({ id: it.id, kind: it.kind, date: it.date, text: it.text })),
        }),
      })
      const data = await res.json()
      setDrafts(d => ({
        ...d,
        [target]: {
          loading: false,
          suggestion: data?.suggestion || null,
          sources: items,
          message: data?.suggestion ? null : (data?.message || data?.error || "BenchCoach couldn't draft this right now."),
          showSources: false,
        },
      }))
    } catch {
      setDrafts(d => ({ ...d, [target]: { loading: false, suggestion: null, sources: items, message: "BenchCoach couldn't reach the drafting assistant. You can still add the items as notes.", showSources: false } }))
    }
  }

  const applyDraft = (target: 'strengths' | 'closing') => {
    const d = drafts[target]
    if (!d?.suggestion) return
    onUseDraft(target, d.suggestion)
    track('player_report_sources_used', { reportId, target, mode: 'draft', count: d.sources.length })
    setAdded(a => ({ ...a, [target]: 'Draft placed in the section — edit it there' }))
    setDrafts(x => ({ ...x, [target]: undefined }))
  }

  // ---- render -----------------------------------------------------------

  if (loading && !bundle) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-10">
        <Loader2 className="animate-spin" size={16} aria-hidden />
        Looking through what you have recorded for {playerFirstName}…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
        {error} You can still write the report from scratch — press Next.
      </div>
    )
  }

  const total = bundle?.items.length || 0
  const selectedCount = Object.keys(selected).length

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600">
          {total === 0
            ? `Nothing recorded for ${playerFirstName} ${allSeasons ? 'yet' : 'this season'}. The report starts fresh — you can still write everything yourself.`
            : `${total} thing${total === 1 ? '' : 's'} recorded ${allSeasons ? 'so far' : 'this season'}. Tick what belongs in the report, say where, then add it as your notes or let BenchCoach draft from it.`}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={allSeasons}
            onChange={e => setAllSeasons(e.target.checked)}
            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <History size={14} aria-hidden />
          Include earlier seasons
        </label>
      </div>

      {bundle?.skillLevels && Object.values(bundle.skillLevels).some(v => v != null) && (
        <div className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">Roster ratings</span> (for you — never printed):{' '}
          {Object.entries(bundle.skillLevels).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}/5`).join(' · ')}
        </div>
      )}

      {GROUPS.map(g => {
        const items = byKind.get(g.kind) || []
        if (!items.length) return null
        const isCollapsed = collapsed[g.kind]
        return (
          <section key={g.kind} className="rounded-lg border border-gray-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setCollapsed(c => ({ ...c, [g.kind]: !c[g.kind] }))}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 text-left"
              aria-expanded={!isCollapsed}
            >
              <span className="flex items-center gap-2">
                {g.kind === 'trait' && <Lock size={14} className="text-amber-600" aria-hidden />}
                <span className="font-semibold text-gray-900 text-sm">{g.title}</span>
                <span className="text-xs text-gray-500">({items.length})</span>
              </span>
              {isCollapsed ? <ChevronDown size={16} className="text-gray-400" aria-hidden /> : <ChevronUp size={16} className="text-gray-400" aria-hidden />}
            </button>
            {!isCollapsed && (
              <div>
                {g.hint && <p className="px-3 pt-2 text-xs text-gray-500">{g.hint}</p>}
                <ul className="divide-y divide-gray-100">
                  {items.map(it => {
                    const on = Boolean(selected[it.id])
                    return (
                      <li key={it.id} className={`px-3 py-2.5 ${on ? 'bg-red-50/40' : ''}`}>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            id={`src-${it.id}`}
                            checked={on}
                            disabled={disabled}
                            onChange={() => toggle(it)}
                            className="mt-1 rounded border-gray-300 text-red-600 focus:ring-red-500"
                          />
                          <label htmlFor={`src-${it.id}`} className="flex-1 min-w-0 cursor-pointer">
                            <span className="block text-xs text-gray-500">
                              {it.date ? formatReportDate(it.date) : 'Undated'} · {it.title}
                              {it.sensitive && <span className="ml-1.5 text-amber-700 font-medium">private</span>}
                            </span>
                            <span className="block text-sm text-gray-800 mt-0.5 whitespace-pre-wrap">{it.text}</span>
                          </label>
                          {on && (
                            <select
                              value={selected[it.id]}
                              onChange={e => retarget(it.id, e.target.value as SourceTarget)}
                              disabled={disabled}
                              aria-label={`Where to use: ${it.title}`}
                              className="shrink-0 text-xs px-2 py-1.5 border border-gray-300 rounded-lg bg-white"
                            >
                              <option value="strengths">Strengths</option>
                              <option value="development">Development</option>
                              <option value="closing">Closing</option>
                            </select>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </section>
        )
      })}

      {/* ---- what to do with the selection ---------------------------------- */}
      {selectedCount > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/40 p-3 space-y-4">
          <p className="text-sm font-medium text-gray-900">
            {selectedCount} selected. For each section:
          </p>
          {(['strengths', 'development', 'closing'] as SourceTarget[]).map(target => {
            const items = selectedFor(target)
            if (!items.length) return null
            const d = drafts[target]
            const canDraft = target !== 'development'
            return (
              <div key={target} className="rounded-lg bg-white border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {TARGET_LABEL[target]} <span className="font-normal text-gray-500">({items.length})</span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addAsNotes(target)}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ListPlus size={15} aria-hidden />
                      {target === 'development' ? 'Add as development areas' : 'Add as my notes'}
                    </button>
                    {canDraft && (
                      <button
                        type="button"
                        onClick={() => draft(target as 'strengths' | 'closing')}
                        disabled={disabled || d?.loading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {d?.loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
                        Draft with BenchCoach
                      </button>
                    )}
                  </div>
                </div>

                {added[target] && (
                  <p className="mt-2 text-xs text-green-800 inline-flex items-center gap-1">
                    <Check size={13} aria-hidden /> {added[target]}
                  </p>
                )}

                {d?.message && (
                  <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{d.message}</p>
                )}

                {d?.suggestion && (
                  <div className="mt-3 rounded-lg border border-red-200 overflow-hidden" aria-live="polite">
                    <div className="px-3 py-2 border-b border-red-200 bg-red-50/60 flex items-center gap-1.5">
                      <Sparkles size={14} className="text-red-600" aria-hidden />
                      <span className="text-xs font-semibold text-red-800 uppercase tracking-wide">
                        BenchCoach drafted from {d.sources.length} item{d.sources.length === 1 ? '' : 's'} you picked
                      </span>
                    </div>
                    <p className="px-3 py-3 text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap">{d.suggestion}</p>
                    <div className="px-3 pb-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => applyDraft(target as 'strengths' | 'closing')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700">
                        <Check size={15} aria-hidden /> Use this
                      </button>
                      <button type="button" onClick={() => draft(target as 'strengths' | 'closing')} disabled={d.loading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                        <RotateCcw size={15} aria-hidden /> Try again
                      </button>
                      <button type="button" onClick={() => setDrafts(x => ({ ...x, [target]: undefined }))}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                        <X size={15} aria-hidden /> Not this
                      </button>
                      <button type="button"
                        onClick={() => setDrafts(x => ({ ...x, [target]: { ...(x[target] as DraftState), showSources: !(x[target] as DraftState).showSources } }))}
                        className="ml-auto text-xs text-gray-500 hover:text-gray-800 underline">
                        {d.showSources ? 'Hide sources' : `Sources (${d.sources.length})`}
                      </button>
                    </div>
                    {d.showSources && (
                      <ul className="px-3 pb-3 space-y-1 text-xs text-gray-600 border-t border-gray-100 pt-2">
                        {d.sources.map(s => (
                          <li key={s.id}>• {s.date ? formatReportDate(s.date) + ' — ' : ''}{s.text}</li>
                        ))}
                      </ul>
                    )}
                    <p className="px-3 pb-3 text-xs text-gray-500">
                      Use this puts it in the section. Everything in it comes from the items above — you can still edit every word.
                    </p>
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

export default SourcePicker
