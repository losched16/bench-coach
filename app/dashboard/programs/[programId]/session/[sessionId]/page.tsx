'use client'

// Today's workout. Everything needed to run it on one screen: time, equipment,
// ordered drills with instructions, counts, cues, videos, completion controls,
// notes and measurements. Works as a simple view a child can follow.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { useRole } from '@/lib/useRole'
import { Chip, DrillBody, SKILL_LABEL, SUPERVISION_LABEL, prettyDate, today } from '@/components/programs/parts'

type Rating = 'easy' | 'right' | 'hard'

export default function SessionPage() {
  const { programId, sessionId } = useParams() as { programId: string; sessionId: string }
  const teamId = useSearchParams().get('teamId')
  const { can } = useRole(teamId)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [kid, setKid] = useState(false)
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [pain, setPain] = useState(false)
  const [notes, setNotes] = useState('')
  const [minutes, setMinutes] = useState('')
  const [conditions, setConditions] = useState('')
  const [vals, setVals] = useState<Record<string, { value?: string; successes?: string; attempts?: string }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    const res = await fetch(`/api/development-program?teamId=${teamId}&programId=${programId}`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error || 'Could not load.'); return }
    setData(d)
    const s = d.sessions.find((x: any) => x.id === sessionId)
    if (s?.completion) {
      const c = s.completion
      setChecked(Object.fromEntries((c.drills_done || []).map((x: any) => [x.position, !!x.done])))
      setRatings(c.ratings || {}); setPain(!!c.pain_reported); setNotes(c.notes || ''); setMinutes(c.actual_minutes ? String(c.actual_minutes) : '')
    }
  }, [teamId, programId, sessionId])
  useEffect(() => { load() }, [load])

  if (!teamId) return <p className="p-4 text-sm text-red-700">Open this from your program.</p>
  if (error) return <p className="p-4 text-sm text-red-700" role="alert">{error}</p>
  if (!data) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-400" size={32} aria-label="Loading" /></div>
  const s = data.sessions.find((x: any) => x.id === sessionId)
  if (!s) return <p className="p-4 text-sm text-red-700">Session not found.</p>

  const done = s.status === 'completed'
  const blocks: Array<{ index: number; kind: string; title: string; minutes: number; drills: any[] }> = []
  for (const d of s.drills) {
    let b = blocks.find(x => x.index === d.block_index)
    if (!b) { b = { index: d.block_index, kind: d.block_kind, title: d.block_title, minutes: d.block_minutes, drills: [] }; blocks.push(b) }
    b.drills.push(d)
  }
  const planned: any[] = s.assessments || []
  const q = `?teamId=${teamId}`

  async function complete() {
    setBusy(true); setMsg(null)
    const readings = planned.map(a => ({ slug: a.metricSlug, ...vals[a.metricSlug], attempts: vals[a.metricSlug]?.attempts ?? '10', conditions, checkpoint: s.checkpoint || 'session' }))
      .filter(r => (r as any).value || (r as any).successes)
    const res = await fetch('/api/development-program/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, programId, sessionId, action: 'complete', on: today(), minutes: minutes ? Number(minutes) : undefined,
        drills: s.drills.map((d: any) => ({ position: d.position, done: !!checked[d.position] })), ratings, pain, notes, readings }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(d.error || 'Could not record that.'); return }
    setMsg(pain ? 'Recorded. Pain was noted — stop that kind of work and have the arm looked at before continuing.' : 'Recorded. Nice work.')
    load()
  }
  async function undo() {
    if (!confirm('Re-open this session? Its measurements will be removed so you can record it again.')) return
    setBusy(true)
    const res = await fetch('/api/development-program/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, programId, sessionId, action: 'undo' }) })
    setBusy(false)
    if (res.ok) { setChecked({}); setMsg('Re-opened.'); load() } else setMsg((await res.json().catch(() => ({}))).error || 'Could not re-open.')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      <Link href={`/dashboard/programs/${programId}${q}`} className="text-sm text-gray-600 underline">Back to the program</Link>
      <header>
        <div className="flex flex-wrap items-center gap-2"><Chip kind={s.kind} />{s.checkpoint && <Chip kind="assessment">{s.checkpoint}</Chip>}{done && <span className="text-sm text-green-800 font-medium flex items-center gap-1"><CheckCircle2 size={16} aria-hidden /> Done</span>}</div>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{s.title}</h1>
        <p className="text-sm text-gray-700">{prettyDate(s.scheduled_date)} · about {s.est_minutes} minutes · {SUPERVISION_LABEL[s.supervision]}</p>
        {s.equipment?.length > 0 && <p className="text-sm text-gray-700">Bring: {s.equipment.join(', ')}</p>}
        {s.coach_note && <p className="text-sm text-gray-800 mt-2 bg-gray-50 rounded p-2">{s.coach_note}</p>}
        {s.filming_note && <p className="text-sm text-gray-800 mt-2">🎥 {s.filming_note}</p>}
        {s.requires_throwing_gate && <p className="text-sm text-purple-900 bg-purple-50 border border-purple-200 rounded p-2 mt-2 flex gap-1"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />Throwing steps are only for when the coach has cleared the throwing gate. If the gate is closed, do the arm-care and legs-and-balance work instead.</p>}
        <label className="inline-flex items-center gap-2 mt-2 text-sm min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={kid} onChange={e => setKid(e.target.checked)} /> Simple view for the player</label>
      </header>

      {blocks.map(b => (
        <section key={b.index} aria-label={b.title} className="space-y-2">
          <h2 className="font-semibold text-gray-900">{b.title} <span className="font-normal text-gray-600">· {b.minutes} min</span></h2>
          {b.drills.map(d => (
            <div key={d.id} className={`bg-white border rounded-xl p-3 ${checked[d.position] ? 'border-green-300' : 'border-gray-200'}`}>
              <label className="flex items-start gap-3 min-h-[44px]">
                <input type="checkbox" className="h-6 w-6 mt-0.5" checked={!!checked[d.position]} disabled={done} onChange={e => setChecked(c => ({ ...c, [d.position]: e.target.checked }))} />
                <span className="flex-1"><span className="font-medium text-gray-900 text-base">{d.name}</span> <span className="text-sm text-gray-600">· {d.minutes} min</span></span>
              </label>
              <div className="pl-9 mt-1"><DrillBody d={d} media={data.drillMedia} kid={kid} /></div>
            </div>
          ))}
        </section>
      ))}

      {planned.length > 0 && (
        <section aria-label="Measurements" className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-3">
          <h2 className="font-semibold text-amber-900">Checkpoint measurements</h2>
          <label className="block text-sm">Conditions (surface, weather, who timed it)<input className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={conditions} onChange={e => setConditions(e.target.value)} maxLength={300} disabled={done} /></label>
          {planned.map((a: any) => { const t = data.metricTypes?.[a.metricSlug]; const prior = (data.readings || []).filter((r: any) => r.program_session_id === s.id && r.metric === a.label)
            return (
              <div key={a.metricSlug} className="text-sm">
                <p className="font-medium">{a.label}</p><p className="text-xs text-gray-700">{a.protocol}</p>
                {prior.length > 0 && <p className="text-xs text-green-800">Recorded: {prior.map((r: any) => r.successes != null ? `${r.successes}/${r.attempts}` : `${r.value} ${r.unit || ''}`).join(', ')}</p>}
                {!done && (t?.shape === 'challenge' || a.shape === 'challenge'
                  ? <span>successes <input inputMode="numeric" className="w-16 border border-gray-300 rounded px-1 min-h-[44px]" onChange={e => setVals(v => ({ ...v, [a.metricSlug]: { ...v[a.metricSlug], successes: e.target.value } }))} /> of <input inputMode="numeric" defaultValue={a.attempts ?? 10} className="w-16 border border-gray-300 rounded px-1 min-h-[44px]" onChange={e => setVals(v => ({ ...v, [a.metricSlug]: { ...v[a.metricSlug], attempts: e.target.value } }))} /></span>
                  : <span><input inputMode="decimal" className="w-24 border border-gray-300 rounded px-1 min-h-[44px]" onChange={e => setVals(v => ({ ...v, [a.metricSlug]: { ...v[a.metricSlug], value: e.target.value } }))} /> {a.unit}</span>)}
              </div>) })}
        </section>
      )}

      <section aria-label="How it went" className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
        <h2 className="font-semibold text-gray-900">How did it go?</h2>
        {(s.focus || []).map((f: string) => (
          <fieldset key={f} className="text-sm"><legend className="font-medium">{SKILL_LABEL[f] || f}</legend>
            <div className="flex gap-2 mt-1">{([['easy', 'Too easy'], ['right', 'Just right'], ['hard', 'Too hard']] as const).map(([v, l]) => (
              <label key={v} className={`px-3 min-h-[44px] inline-flex items-center rounded-lg border cursor-pointer ${ratings[f] === v ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300'}`}>
                <input type="radio" className="sr-only" name={`r-${f}`} checked={ratings[f] === v} disabled={done} onChange={() => setRatings(r => ({ ...r, [f]: v }))} />{l}</label>))}</div></fieldset>
        ))}
        <label className="flex items-start gap-2 text-sm min-h-[44px]"><input type="checkbox" className="h-5 w-5 mt-0.5" checked={pain} disabled={done} onChange={e => setPain(e.target.checked)} /> Any pain, soreness or unusual tiredness today</label>
        <label className="block text-sm">Minutes it actually took<input inputMode="numeric" className="block w-24 border border-gray-300 rounded min-h-[44px] px-2" value={minutes} disabled={done} onChange={e => setMinutes(e.target.value)} /></label>
        <label className="block text-sm">Notes<textarea className="block w-full border border-gray-300 rounded p-2" rows={3} maxLength={2000} value={notes} disabled={done} onChange={e => setNotes(e.target.value)} /></label>
        {msg && <p role="status" className="text-sm text-gray-800">{msg}</p>}
        {s.status === 'planned' && can('record') && (
          <button onClick={complete} disabled={busy} className="inline-flex items-center gap-2 px-5 min-h-[48px] rounded-lg bg-red-700 text-white font-medium disabled:opacity-60">{busy && <Loader2 className="animate-spin" size={16} aria-hidden />}Mark session complete</button>
        )}
        {done && can('decide') && <button onClick={undo} disabled={busy} className="px-4 min-h-[44px] rounded-lg border border-gray-300 text-sm">Re-open this session</button>}
        {done && s.completion && !s.completion.coach_confirmed && <p className="text-xs text-gray-600">Recorded by a helper — waiting for the head coach to confirm.</p>}
      </section>
    </div>
  )
}
