'use client'

// A saved Development Program: overview, weekly calendar, assessments and
// suggested adjustments. Today's workout is one tap away.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useRole } from '@/lib/useRole'
import { Chip, SKILL_LABEL, dayName, prettyDate, today } from '@/components/programs/parts'

type Tab = 'overview' | 'calendar' | 'assessments' | 'adjustments'

export default function ProgramPage() {
  const { programId } = useParams() as { programId: string }
  const teamId = useSearchParams().get('teamId')
  const { can } = useRole(teamId)
  const [data, setData] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [week, setWeek] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!teamId) return
    const res = await fetch(`/api/development-program?teamId=${teamId}&programId=${programId}`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error || 'Could not load the program.'); return }
    setData(d)
  }, [teamId, programId])
  useEffect(() => { load() }, [load])

  const sessions: any[] = data?.sessions || []
  const trainable = sessions.filter(s => s.kind !== 'rest')
  const done = trainable.filter(s => s.status === 'completed').length
  const t = today()
  const todays = sessions.filter(s => s.scheduled_date === t && s.kind !== 'rest')
  const nextCheckpoint = sessions.find(s => s.checkpoint && s.status === 'planned' && s.scheduled_date >= t)
  const currentPhase = (data?.phases || []).find((p: any) => t >= p.start_date && t <= p.end_date)
    ?? (data?.phases || []).find((p: any) => t < p.start_date)
  const weeks = useMemo(() => Array.from(new Set(sessions.map(s => s.week))).sort((a: any, b: any) => a - b) as number[], [sessions])
  const shownWeek = week ?? (sessions.find(s => s.scheduled_date >= t)?.week ?? weeks[0] ?? 1)

  async function post(url: string, body: any) {
    setBusy(true); setNote(null)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, programId, ...body }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setNote(d.error || 'That did not work.'); return null }
    return d
  }

  async function reschedule(sessionId: string, date: string) {
    setBusy(true); setNote(null)
    const res = await fetch('/api/development-program/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, programId, sessionId, date }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) setNote(d.error || 'Could not move it.'); else load()
  }

  if (!teamId) return <p className="p-4 text-sm text-red-700">Open this from your team so I know which one.</p>
  if (error) return <p className="p-4 text-sm text-red-700" role="alert">{error}</p>
  if (!data) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-400" size={32} aria-label="Loading" /></div>
  const p = data.program, src = p.source || {}
  const q = `?teamId=${teamId}`
  const proposals = (data.revisions || []).filter((r: any) => r.status === 'proposed')

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
      <header>
        <Link href={`/dashboard/development${q}`} className="text-sm text-gray-600 underline">Development</Link>
        <h1 className="text-2xl font-bold text-gray-900">{p.title}</h1>
        <p className="text-sm text-gray-700">{prettyDate(p.start_date)} – {prettyDate(p.end_date)} · version {p.version} · {done} of {trainable.length} sessions done</p>
        <div className="h-2 bg-gray-200 rounded mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={trainable.length} aria-valuenow={done} aria-label="Sessions completed">
          <div className="h-2 bg-red-700 rounded" style={{ width: `${trainable.length ? (done / trainable.length) * 100 : 0}%` }} />
        </div>
      </header>

      {todays.length > 0 ? (
        <section aria-label="Today" className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <span className="font-medium text-red-900">Today</span>
          {todays.map(s => (
            <Link key={s.id} href={`/dashboard/programs/${programId}/session/${s.id}${q}`} className="inline-flex items-center min-h-[44px] px-4 rounded-lg bg-red-700 text-white text-sm font-medium">
              {s.status === 'completed' ? 'Review' : 'Open'}: {s.title}
            </Link>
          ))}
        </section>
      ) : <p className="text-sm text-gray-600">Nothing scheduled today.</p>}

      <div role="tablist" aria-label="Program sections" className="flex gap-2 overflow-x-auto">
        {([['overview', 'Overview'], ['calendar', 'Calendar'], ['assessments', 'Progress'], ['adjustments', `Adjustments${proposals.length ? ` (${proposals.length})` : ''}`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 min-h-[44px] rounded-lg border text-sm shrink-0 ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-800'}`}>{label}</button>
        ))}
      </div>
      {note && <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded p-2">{note}</p>}

      {tab === 'overview' && (
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="font-semibold text-gray-900">Current phase</h2>
            {currentPhase ? <p className="text-sm text-gray-700 mt-1"><b>{currentPhase.name}</b> ({prettyDate(currentPhase.start_date)} – {prettyDate(currentPhase.end_date)}). {currentPhase.difficulty}</p> : <p className="text-sm text-gray-600">The program is complete.</p>}
            {nextCheckpoint && <p className="text-sm text-gray-700 mt-2">Next checkpoint: <b>{nextCheckpoint.checkpoint}</b> on {prettyDate(nextCheckpoint.scheduled_date)}.</p>}
          </section>
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="font-semibold text-gray-900 mb-2">Skills</h2>
            <ul className="space-y-2 text-sm">
              {(data.skills || []).map((s: any) => (
                <li key={s.id}><b>{s.priority}. {s.label}</b>
                  {s.progress_id && <> — <Link className="underline text-red-700" href={`/dashboard/development${q}`}>development plan{s.current_stage ? `: ${s.current_stage}` : ''}</Link></>}
                  <div className="text-gray-600">{s.rationale}</div>
                  {s.baseline && <div className="text-gray-600">Baseline: {s.baseline}</div>}
                </li>
              ))}
            </ul>
          </section>
          {src.throwingGate && <section className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-sm text-purple-900"><b>Throwing:</b> {src.throwingGate.cleared ? 'cleared by the coach.' : 'the gate is closed — pitching work is arm care and legs-and-balance until a coach clears it.'} {src.throwingGate.note}</section>}
          {(src.progressionRules || []).length > 0 && (
            <details className="bg-white border border-gray-200 rounded-xl p-4"><summary className="font-semibold text-gray-900 cursor-pointer min-h-[44px] flex items-center">When to advance, hold or back off</summary>
              <ul className="list-disc pl-5 text-sm text-gray-700 mt-2 space-y-1">{src.progressionRules.map((r: any, i: number) => <li key={i}><b>{r.action}:</b> {r.when}</li>)}</ul></details>
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <div>
          <nav aria-label="Weeks" className="flex gap-2 overflow-x-auto pb-2">
            {weeks.map(w => <button key={w} onClick={() => setWeek(w)} aria-current={w === shownWeek ? 'true' : undefined} className={`shrink-0 px-3 min-h-[44px] rounded-lg border text-sm ${w === shownWeek ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>Week {w}</button>)}
          </nav>
          <ul className="space-y-2">
            {sessions.filter(s => s.week === shownWeek).map(s => (
              <li key={s.id} className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
                <span className="w-24 font-medium text-gray-900">{dayName(s.scheduled_date)} {s.scheduled_date.slice(5)}</span>
                <Chip kind={s.kind} />
                {s.status === 'completed' && <span className="text-xs text-green-800 font-medium">✓ Done</span>}
                {s.status === 'skipped' && <span className="text-xs text-gray-600">Skipped</span>}
                {s.kind === 'rest' ? <span className="text-sm text-gray-600">Rest</span> : (
                  <Link className="text-sm text-red-700 underline min-h-[44px] inline-flex items-center" href={`/dashboard/programs/${programId}/session/${s.id}${q}`}>{s.title} · {s.est_minutes} min</Link>
                )}
                {can('decide') && s.status === 'planned' && s.kind !== 'independent' && (
                  <label className="ml-auto text-xs text-gray-600">Move to <input type="date" className="border border-gray-300 rounded px-1 min-h-[36px]" defaultValue={s.scheduled_date} onBlur={e => { if (e.target.value && e.target.value !== s.scheduled_date) reschedule(s.id, e.target.value) }} /></label>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'assessments' && <Assessments data={data} teamId={teamId} programId={programId} onSaved={load} />}

      {tab === 'adjustments' && (
        <section className="space-y-3">
          <p className="text-sm text-gray-700">Suggestions come from what has been recorded. One session never changes the plan, and nothing changes until the head coach approves it. Completed sessions are never edited.</p>
          <button disabled={busy} onClick={async () => { const d = await post('/api/development-program/revision', { action: 'propose' }); if (d) { setNote(d.created ? `${d.created} suggestion(s) added.` : (d.advice?.[0]?.summary || 'Nothing to suggest yet — keep going as planned.')); load() } }} className="px-4 min-h-[44px] rounded-lg border border-gray-300 text-sm">Check for suggestions</button>
          {proposals.map((r: any) => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-3 text-sm">
              <p className="font-medium text-gray-900">{r.summary}</p>
              <ul className="list-disc pl-5 text-gray-600 mt-1">{(r.evidence || []).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
              {can('decide') ? (
                <div className="flex gap-2 mt-2">
                  <button disabled={busy} className="px-3 min-h-[44px] rounded-lg bg-red-700 text-white" onClick={async () => { const d = await post('/api/development-program/revision', { action: 'apply', revisionId: r.id }); if (d) { setNote(`Applied to ${d.sessionsChanged} future session(s).`); load() } }}>Approve for future sessions</button>
                  <button disabled={busy} className="px-3 min-h-[44px] rounded-lg border border-gray-300" onClick={async () => { await post('/api/development-program/revision', { action: 'reject', revisionId: r.id }); load() }}>Dismiss</button>
                </div>
              ) : <p className="text-xs text-gray-500 mt-1">The head coach decides on this.</p>}
            </div>
          ))}
          {(data.revisions || []).filter((r: any) => r.status !== 'proposed').slice(0, 5).map((r: any) => <p key={r.id} className="text-xs text-gray-500">{r.status}: {r.summary}</p>)}
        </section>
      )}
    </div>
  )
}

function Assessments({ data, teamId, programId, onSaved }: { data: any; teamId: string; programId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [checkpoint, setCheckpoint] = useState('baseline')
  const [conditions, setConditions] = useState('')
  const [vals, setVals] = useState<Record<string, { value?: string; successes?: string; attempts?: string }>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const types = data.metricTypes || {}
  async function submit() {
    const readings = Object.entries(vals).map(([slug, v]) => ({ slug, value: v.value, successes: v.successes, attempts: v.attempts ?? '10' })).filter(r => r.value || r.successes)
    const res = await fetch('/api/development-program/assessment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, programId, checkpoint, conditions, readings, on: today() }) })
    const d = await res.json().catch(() => ({}))
    setMsg(res.ok ? `Recorded ${d.recorded} measurement(s).` : d.error || 'Could not record.'); if (res.ok) { setVals({}); onSaved() }
  }
  const lines: any[] = data.assessments || []
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">Each line compares the baseline with the latest reading taken the same way. Fewer than three readings is a direction, not a trend, and small samples are marked low confidence.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm bg-white border border-gray-200 rounded-xl">
        <thead><tr className="text-left text-gray-600"><th className="p-2">Measure</th><th className="p-2">Baseline</th><th className="p-2">Latest</th><th className="p-2">Change</th><th className="p-2">Readings</th><th className="p-2">Confidence</th></tr></thead>
        <tbody>{lines.map(l => (
          <tr key={l.slug} className="border-t border-gray-100 align-top">
            <td className="p-2"><b>{l.label}</b><div className="text-xs text-gray-500">{l.conditions || ''}</div></td>
            <td className="p-2">{l.baseline ?? '—'}</td><td className="p-2">{l.latest ?? '—'}</td>
            <td className="p-2">{({ improved: 'Better', worse: 'Worse', about_the_same: 'About the same', not_enough_data: 'Not enough data' } as any)[l.direction]}<div className="text-xs text-gray-500">{l.note}</div></td>
            <td className="p-2">{l.readings}{l.attempts ? ` (${l.attempts} attempts)` : ''}</td><td className="p-2">{l.confidence}</td>
          </tr>))}</tbody></table></div>
      <button onClick={() => setOpen(o => !o)} className="px-4 min-h-[44px] rounded-lg border border-gray-300 text-sm" aria-expanded={open}>Record measurements</button>
      {open && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
          <label className="block text-sm">Checkpoint <select value={checkpoint} onChange={e => setCheckpoint(e.target.value)} className="border border-gray-300 rounded min-h-[44px] px-2"><option value="baseline">Baseline</option><option value="midpoint">Midpoint</option><option value="final">Final</option><option value="session">Other</option></select></label>
          <label className="block text-sm">Conditions (surface, weather, who timed it)<input value={conditions} onChange={e => setConditions(e.target.value)} className="block w-full border border-gray-300 rounded min-h-[44px] px-2" maxLength={300} /></label>
          {lines.map(l => { const t = types[l.slug]; if (!t) return null
            return <div key={l.slug} className="text-sm"><span className="font-medium">{l.label}</span>{' '}
              {t.shape === 'challenge' ? <span>successes <input inputMode="numeric" className="w-16 border border-gray-300 rounded px-1 min-h-[44px]" onChange={e => setVals(v => ({ ...v, [l.slug]: { ...v[l.slug], successes: e.target.value } }))} /> of <input inputMode="numeric" defaultValue={10} className="w-16 border border-gray-300 rounded px-1 min-h-[44px]" onChange={e => setVals(v => ({ ...v, [l.slug]: { ...v[l.slug], attempts: e.target.value } }))} /></span>
                : <span><input inputMode="decimal" className="w-24 border border-gray-300 rounded px-1 min-h-[44px]" onChange={e => setVals(v => ({ ...v, [l.slug]: { ...v[l.slug], value: e.target.value } }))} /> {t.unit}</span>}</div> })}
          <button onClick={submit} className="px-4 min-h-[44px] rounded-lg bg-red-700 text-white text-sm">Save measurements</button>
          {msg && <p role="status" className="text-sm text-gray-700">{msg}</p>}
        </div>
      )}
    </div>
  )
}
