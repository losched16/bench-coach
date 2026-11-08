'use client'

// Review & Create Development Program.
//
// The complete generated program as an editable draft. Nothing here is a saved
// record: edits go to the draft, and only "Save program" (head coach) makes it
// real. Every session of every week is reachable from this page.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Loader2, Save, Trash2 } from 'lucide-react'
import { useRole } from '@/lib/useRole'
import { Chip, DrillRow, SKILL_LABEL, SUPERVISION_LABEL, dayName, prettyDate } from '@/components/programs/parts'
import type { ProgramDraft, ProgramSession } from '@/lib/programs/types'

export default function DraftPage() {
  const { draftId } = useParams() as { draftId: string }
  const teamId = useSearchParams().get('teamId')
  const router = useRouter()
  const { can } = useRole(teamId)
  const [draft, setDraft] = useState<ProgramDraft | null>(null)
  const [version, setVersion] = useState(1)
  const [status, setStatus] = useState('draft')
  const [week, setWeek] = useState(1)
  const [busy, setBusy] = useState<'save' | 'edit' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!teamId) { setLoading(false); return }
    const res = await fetch(`/api/development-program/draft?teamId=${teamId}&draftId=${draftId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Could not load the draft.'); setLoading(false); return }
    setDraft(data.draft); setVersion(data.version); setStatus(data.status); setLoading(false)
    if (data.status === 'saved' && data.savedProgramId) router.replace(`/dashboard/programs/${data.savedProgramId}?teamId=${teamId}`)
  }, [teamId, draftId, router])
  useEffect(() => { load() }, [load])

  const sessionsByWeek = useMemo(() => {
    const m = new Map<number, ProgramSession[]>()
    for (const s of draft?.sessions || []) { if (!m.has(s.week)) m.set(s.week, []); m.get(s.week)!.push(s) }
    m.forEach(v => v.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)))
    return m
  }, [draft])

  function edit(fn: (d: ProgramDraft) => void) {
    setDraft(prev => { if (!prev) return prev; const next = JSON.parse(JSON.stringify(prev)) as ProgramDraft; fn(next); return next })
    setDirty(true)
  }

  async function persist(): Promise<boolean> {
    if (!draft || !teamId) return false
    setBusy('edit'); setError(null)
    const res = await fetch('/api/development-program/draft', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, draftId, version, draft }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(data.error || 'Could not save your edits.'); return false }
    setDraft(data.draft); setVersion(data.version); setDirty(false)
    return true
  }

  async function approve() {
    if (!teamId) return
    if (dirty && !(await persist())) return
    setBusy('save'); setError(null); setProblems([])
    const res = await fetch('/api/development-program/draft/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, draftId }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(data.error || 'Could not save.'); setProblems(data.problems || []); return }
    router.push(`/dashboard/programs/${data.programId}?teamId=${teamId}`)
  }

  async function discard() {
    if (!teamId || !confirm('Discard this draft? Nothing has been saved, so nothing else is affected.')) return
    setBusy('discard')
    await fetch(`/api/development-program/draft?teamId=${teamId}&draftId=${draftId}`, { method: 'DELETE' })
    router.push(`/dashboard/development?teamId=${teamId}`)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-400" size={32} aria-label="Loading" /></div>
  if (!teamId || !draft) return <p className="p-4 text-sm text-red-700" role="alert">{error || 'Draft not found.'}</p>

  const failed = (draft.qualityReport?.checks || []).filter(c => !c.ok)
  const weekSessions = sessionsByWeek.get(week) || []
  const coachCan = can('decide')

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 space-y-5">
      <header>
        <p className="text-xs uppercase tracking-wide text-gray-500">Draft — not saved</p>
        <h1 className="text-2xl font-bold text-gray-900">{draft.title}</h1>
        <p className="text-sm text-gray-700 mt-1">{draft.summary}</p>
      </header>

      {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{error}{problems.length > 0 && <ul className="list-disc pl-5 mt-1">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}</div>}

      <section aria-labelledby="priorities" className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 id="priorities" className="font-semibold text-gray-900 mb-2">Priorities</h2>
        <p className="text-xs text-gray-600 mb-2">Priority decides how much time a skill gets. No requested skill was removed.</p>
        <ul className="space-y-2">
          {draft.skills.map(s => (
            <li key={s.skill} className="text-sm">
              <span className="font-medium">{s.priority}. {s.label}</span>
              <span className="text-gray-600"> — {s.rationale}</span>
              {s.baseline && <div className="text-xs text-gray-600">Baseline: {s.baseline}</div>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="basis" className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 id="basis" className="font-semibold text-gray-900 mb-2">What this is based on</h2>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          {([['Recorded facts', 'recorded'], ['Coach observations', 'coach_observation'], ['What you told me', 'user_reported'], ['AI hypotheses (check them)', 'ai_interpretation'], ['Not known', 'missing']] as const).map(([title, src]) => {
            const items = [...draft.assessment.strengths, ...draft.assessment.needs, ...draft.assessment.concerns, ...draft.assessment.history, ...draft.assessment.unknowns].filter(e => e.source === src)
            if (!items.length) return null
            return <div key={src}><h3 className="font-medium text-gray-900">{title}</h3><ul className="list-disc pl-5 text-gray-700">{items.slice(0, 6).map((e, i) => <li key={i}>{e.on ? `${e.on}: ` : ''}{e.text}</li>)}</ul></div>
          })}
        </div>
        {draft.assumptions.length > 0 && <div className="mt-3 text-sm"><h3 className="font-medium text-gray-900">Assumptions I made</h3><ul className="list-disc pl-5 text-gray-700">{draft.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      </section>

      {draft.throwingGate && (
        <section aria-labelledby="gate" className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-sm">
          <h2 id="gate" className="font-semibold text-purple-900">Throwing gate — {draft.throwingGate.cleared ? 'cleared' : 'closed'}</h2>
          <p className="text-purple-900 mt-1">{draft.throwingGate.note}</p>
          <ul className="list-disc pl-5 mt-2 text-purple-900">{draft.throwingGate.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {coachCan && (
            <label className="flex items-start gap-2 mt-3 min-h-[44px]">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={draft.throwingGate.cleared} onChange={e => edit(d => { d.throwingGate!.cleared = e.target.checked })} />
              <span>I have checked every item above and I am clearing the player to start the throwing ladder.</span>
            </label>
          )}
        </section>
      )}

      <section aria-labelledby="quality" className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 id="quality" className="font-semibold text-gray-900 mb-2">Quality checks</h2>
        {failed.length === 0 ? <p className="text-sm text-green-800 flex items-center gap-1"><CheckCircle2 size={16} aria-hidden /> All {draft.qualityReport?.checks.length} checks passed.</p>
          : <ul className="text-sm text-amber-900 space-y-1">{failed.map(c => <li key={c.id} className="flex gap-1"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />{c.detail}</li>)}</ul>}
        {(draft.qualityReport?.warnings || []).filter(w => !w.startsWith('Check failed')).map((w, i) => <p key={i} className="text-xs text-gray-600 mt-1">{w}</p>)}
        {draft.curationFlags.length > 0 && <p className="text-xs text-gray-600 mt-2">Library gaps noticed: {draft.curationFlags.join(' ')}</p>}
      </section>

      <nav aria-label="Weeks" className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: draft.brief.weeks }, (_, i) => i + 1).map(w => (
          <button key={w} type="button" onClick={() => setWeek(w)} aria-current={w === week ? 'true' : undefined}
            className={`shrink-0 px-3 min-h-[44px] rounded-lg border text-sm ${w === week ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-800 border-gray-300'}`}>
            Week {w}
          </button>
        ))}
      </nav>
      {(() => { const p = draft.phases.find(p => week >= p.startWeek && week <= p.endWeek); const l = draft.weeklyLoad.find(x => x.week === week)
        return p ? <p className="text-sm text-gray-700"><span className="font-medium">{p.name}</span> — {p.difficulty}{l ? ` (${l.label}: ${l.note})` : ''}</p> : null })()}

      <ul className="space-y-3">
        {weekSessions.map(s => (
          <li key={s.key} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{dayName(s.date)} {s.date.slice(5)}</span>
              <Chip kind={s.kind} />
              {s.checkpoint && <Chip kind="assessment">{s.checkpoint}</Chip>}
              {s.kind !== 'rest' && <span className="text-xs text-gray-600">{s.minutes} min · {SUPERVISION_LABEL[s.supervision]}</span>}
              {s.origin === 'coach' && <span className="text-xs text-gray-500">edited by you</span>}
            </div>
            {s.kind === 'rest' ? <p className="text-sm text-gray-600 mt-1">{s.coachNote}</p> : (
              <>
                <p className="text-sm font-medium text-gray-900 mt-1">{s.title}</p>
                <p className="text-xs text-gray-600">{s.focus.map(f => SKILL_LABEL[f]).join(' · ')}</p>
                {coachCan && (
                  <label className="block mt-2 text-xs text-gray-700">Note for the parent
                    <textarea className="mt-1 w-full border border-gray-300 rounded-lg p-2 text-sm" rows={2} maxLength={500} value={s.coachNote || ''}
                      onChange={e => edit(d => { const t = d.sessions.find(x => x.key === s.key)!; t.coachNote = e.target.value; t.origin = 'coach' })} />
                  </label>
                )}
                {s.filmingNote && <p className="text-xs text-gray-700 mt-1">🎥 {s.filmingNote}</p>}
                <details className="mt-2">
                  <summary className="text-sm text-red-700 cursor-pointer min-h-[44px] flex items-center">Open the full session ({s.blocks.length} blocks)</summary>
                  <div className="space-y-3 mt-2">
                    {s.blocks.map((b, bi) => (
                      <div key={bi}>
                        <h4 className="text-sm font-semibold text-gray-900">{b.title} <span className="font-normal text-gray-600">· {b.minutes} min</span></h4>
                        <ul className="space-y-1 mt-1">{b.drills.map((d, di) => (
                          <div key={di}>
                            <DrillRow d={d as any} />
                            {coachCan && (
                              <div className="flex items-center gap-3 text-xs text-gray-700 px-1 py-1">
                                <label>Minutes <input type="number" min={1} max={60} className="w-16 border border-gray-300 rounded px-1 min-h-[36px]" value={d.minutes}
                                  onChange={e => edit(x => { const t = x.sessions.find(q => q.key === s.key)!; t.blocks[bi].drills[di].minutes = Math.max(1, Math.min(60, Number(e.target.value) || 1)); t.origin = 'coach' })} /></label>
                                {b.drills.length > 1 && <button type="button" className="text-red-700 min-h-[36px]" onClick={() => edit(x => { const t = x.sessions.find(q => q.key === s.key)!; t.blocks[bi].drills.splice(di, 1); t.origin = 'coach' })}>Remove drill</button>}
                              </div>
                            )}
                          </div>
                        ))}</ul>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </li>
        ))}
      </ul>

      <footer className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-200 -mx-4 px-4 py-3 flex flex-wrap items-center gap-2">
        {dirty && <button type="button" onClick={persist} disabled={busy !== null} className="px-4 min-h-[44px] rounded-lg border border-gray-300 text-sm">{busy === 'edit' ? 'Saving edits…' : 'Save my edits to the draft'}</button>}
        {coachCan ? (
          <button type="button" onClick={approve} disabled={busy !== null || status !== 'draft'} className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-lg bg-red-700 text-white text-sm font-medium disabled:opacity-60">
            {busy === 'save' ? <Loader2 className="animate-spin" size={16} aria-hidden /> : <Save size={16} aria-hidden />} Approve and save program
          </button>
        ) : <p className="text-sm text-gray-600">Only the head coach can approve and save this program.</p>}
        <Link href={`/dashboard/chat?teamId=${teamId}`} className="text-sm text-gray-700 underline min-h-[44px] inline-flex items-center">Ask CoachAI to change it</Link>
        {coachCan && <button type="button" onClick={discard} disabled={busy !== null} className="ml-auto inline-flex items-center gap-1 text-sm text-gray-600 min-h-[44px]"><Trash2 size={14} aria-hidden /> Discard</button>}
      </footer>
    </div>
  )
}
