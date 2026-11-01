'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, AlertTriangle, ExternalLink, Check } from 'lucide-react'
import { useRole } from '@/lib/useRole'
import { LEVELS, LEVEL_DEFS } from '@/lib/speedProgram/template'
import { recommendedDays, scheduleWarning } from '@/lib/speedProgram/rules'

// The coach's view of one player's speed program. It shows what the server
// computed and sends what the coach did. Eligibility, comparisons and guidance
// are never worked out here, so the page cannot disagree with the API.

type Json = any
const SCORE_HELP = ['0 · lost control', '1 · inconsistent', '2 · controlled']
const KIND_LABEL: Record<string, string> = { landing: 'Landing', braking: 'Braking', reaction: 'Reaction' }
const cls = {
  card: 'bg-white rounded-lg shadow p-4 sm:p-5',
  h2: 'text-lg font-semibold text-gray-900',
  btn: 'inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50',
  input: 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm',
  label: 'block text-sm font-medium text-gray-700 mb-1',
}

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Json }> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  let data: Json = null
  try { data = await r.json() } catch { /* empty */ }
  return { ok: r.ok, status: r.status, data }
}

export function SpeedProgramView({ playerId, teamId }: { playerId: string; teamId: string | null }) {
  const { can } = useRole(teamId)
  const canDecide = can('decide'), canRecord = can('record')
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<Json>(null)
  const back = `/dashboard/roster/${playerId}?teamId=${teamId}&tab=development`

  const load = useCallback(async () => {
    if (!teamId) { setLoading(false); return }
    const list = await call(`/api/speed-program?teamId=${teamId}&playerId=${playerId}`, 'GET')
    if (list.status === 404) { setUnavailable(true); setLoading(false); return }
    if (!list.ok) { setError(list.data?.error || 'Could not load.'); setLoading(false); return }
    const live = (list.data.programs || []).find((p: any) => p.status !== 'completed')
    if (!live) { setState(null); setLoading(false); return }
    const full = await call(`/api/speed-program/${live.id}`, 'GET')
    if (!full.ok) setError(full.data?.error || 'Could not load.')
    else setState(full.data)
    setLoading(false)
  }, [teamId, playerId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-6 flex items-center text-gray-500"><Loader2 className="animate-spin mr-2" size={18} />Loading…</div>
  if (unavailable) return <div className="p-6 text-gray-600">This program is not available yet.</div>

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5" data-testid="speed-program">
      <Link href={back} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} />Back to player</Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Speed, Agility &amp; Explosiveness</h1>
        <p className="text-sm text-gray-600 mt-1">A four-week, coach-led program. You choose the level and adjust the load around practices and games. Ages are advisory, never a gate.</p>
      </header>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!state
        ? (canDecide
            ? <AssignForm teamId={teamId!} playerId={playerId} onDone={load} setError={setError} />
            : <div className={cls.card}>No speed program is assigned. A head coach or admin can assign one.</div>)
        : <Program s={state} canDecide={canDecide} canRecord={canRecord} reload={load} setError={setError} />}
    </div>
  )
}

// ── assign ──────────────────────────────────────────────────────────────────

function AssignForm({ teamId, playerId, onDone, setError }: { teamId: string; playerId: string; onDone: () => void; setError: (e: string | null) => void }) {
  const [level, setLevel] = useState<string>('development')
  const [f, setF] = useState({ age_band: '', training_background: '', weekly_games: 1, weekly_hard_practices: 1, space: 'outdoor_open', goals: '', notes: '' })
  const [days, setDays] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const rec = recommendedDays(level as any, f.weekly_games, f.weekly_hard_practices)
  const chosen = days ?? rec.days
  const warn = scheduleWarning(chosen, f.weekly_games, f.weekly_hard_practices)
  const num = (k: 'weekly_games' | 'weekly_hard_practices') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Math.max(0, Math.min(7, parseInt(e.target.value || '0', 10) || 0)) })

  async function submit() {
    setBusy(true); setError(null)
    const r = await call('/api/speed-program', 'POST', { teamId, playerId, level, daysPerWeek: chosen, intake: { ...f, age_band: f.age_band || null } })
    setBusy(false)
    if (!r.ok) setError(r.data?.error || 'Could not assign.')
    else onDone()
  }

  return (
    <section className={`${cls.card} space-y-5`} data-testid="assign-form">
      <h2 className={cls.h2}>Assign the program</h2>
      <fieldset>
        <legend className={cls.label}>Level</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {LEVELS.map(l => (
            <label key={l} className={`cursor-pointer rounded-lg border p-3 text-sm ${level === l ? 'border-red-600 bg-red-50' : 'border-gray-200'}`}>
              <input type="radio" name="level" value={l} checked={level === l} onChange={() => setLevel(l)} className="sr-only" />
              <span className="block font-medium">{LEVEL_DEFS[l].label}</span>
              <span className="block text-gray-600 mt-1">{LEVEL_DEFS[l].typicalFit}</span>
              {LEVEL_DEFS[l].review === 'draft' && <span className="mt-2 block text-xs text-amber-800">Draft variant, adapted from the Development program. Review before relying on it.</span>}
            </label>
          ))}
        </div>
        <p className="text-sm text-gray-600 mt-2">{LEVEL_DEFS[level as 'development'].readiness}</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className={cls.label} htmlFor="age">Age band (optional)</label>
          <select id="age" className={cls.input} value={f.age_band} onChange={e => setF({ ...f, age_band: e.target.value })}>
            <option value="">Not stated</option><option value="6-8">6–8</option><option value="9-12">9–12</option><option value="13+">13+</option></select></div>
        <div><label className={cls.label} htmlFor="space">Space available</label>
          <select id="space" className={cls.input} value={f.space} onChange={e => setF({ ...f, space: e.target.value })}>
            <option value="outdoor_open">Open outdoor space</option><option value="indoor_small">Indoor, about 20×15 ft</option></select>
          {f.space === 'indoor_small' && <p className="text-xs text-gray-600 mt-1">Indoors is for short controlled footwork. Full 10-yard sprints and home-to-first tests are not done there.</p>}</div>
        <div><label className={cls.label} htmlFor="games">Games per week</label><input id="games" type="number" min={0} max={7} className={cls.input} value={f.weekly_games} onChange={num('weekly_games')} /></div>
        <div><label className={cls.label} htmlFor="hard">Hard practices per week</label><input id="hard" type="number" min={0} max={7} className={cls.input} value={f.weekly_hard_practices} onChange={num('weekly_hard_practices')} /></div>
        <div className="sm:col-span-2"><label className={cls.label} htmlFor="bg">Training background</label><input id="bg" maxLength={300} className={cls.input} value={f.training_background} onChange={e => setF({ ...f, training_background: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className={cls.label} htmlFor="goals">Goals</label><input id="goals" maxLength={300} className={cls.input} value={f.goals} onChange={e => setF({ ...f, goals: e.target.value })} /></div>
      </div>
      <div>
        <label className={cls.label} htmlFor="days">Dedicated sessions per week</label>
        <select id="days" className={cls.input} value={chosen} onChange={e => setDays(parseInt(e.target.value, 10))}>
          {[1, 2, 3].map(d => <option key={d} value={d}>{d}{d === rec.days ? ' (suggested)' : ''}</option>)}
        </select>
        <p className="text-sm text-gray-600 mt-1">{rec.reason}</p>
        {warn && <p role="note" className="text-sm text-amber-800 mt-1 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />{warn}</p>}
      </div>
      <button className={cls.btn} onClick={submit} disabled={busy} data-testid="assign-submit">{busy && <Loader2 className="animate-spin" size={16} />}Assign program</button>
    </section>
  )
}

// ── the program ─────────────────────────────────────────────────────────────

function Program({ s, canDecide, canRecord, reload, setError }: { s: Json; canDecide: boolean; canRecord: boolean; reload: () => void; setError: (e: string | null) => void }) {
  const p = s.program
  const [logging, setLogging] = useState<string | null>(null)
  const act = async (url: string, method: string, body: unknown) => {
    setError(null)
    const r = await call(url, method, body)
    if (!r.ok) setError(r.data?.error || 'That did not work.')
    else await reload()
    return r
  }
  const base = `/api/speed-program/${p.id}`
  const sessionsToShow = Array.from(new Set([...s.week.planned, ...(['A', 'B', 'C'] as const)])) as string[]

  return (
    <>
      <section className={cls.card} data-testid="program-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={cls.h2}>{p.levelLabel} · Week {p.currentWeek} of 4: {s.week.name}</h2>
            <p className="text-sm text-gray-600 mt-1">{s.week.focus} {s.week.effort}</p>
            <p className="text-sm text-gray-600 mt-1">{s.dose.minutes} · {s.dose.dose}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${p.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`} data-testid="program-status">{p.status}</span>
        </div>
        {p.levelReview === 'draft' && <p className="mt-3 text-sm text-amber-800">This level is a draft adapted from the Development program, not taken from the source. Review it before relying on it.</p>}
        <p className="mt-3 text-sm text-gray-700">This week: {s.week.planned.map((k: string) => {
          const done = s.week.done.includes(k), skipped = s.week.skipped.includes(k)
          return <span key={k} className={`inline-block mr-2 rounded px-2 py-0.5 text-xs ${done ? 'bg-green-100 text-green-800' : skipped ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-800'}`}>Session {k}{done ? ' · done' : skipped ? ' · skipped' : ''}</span>
        })}</p>
        {s.scheduleWarning && <p className="mt-2 text-sm text-amber-800 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />{s.scheduleWarning}</p>}
      </section>

      <section className={`rounded-lg border px-4 py-3 text-sm ${s.guidance.state === 'hold' || s.guidance.state === 'reduce' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-800'}`} data-testid="guidance" data-state={s.guidance.state}>
        {s.guidance.message}
      </section>

      <details className={cls.card}>
        <summary className="cursor-pointer font-medium text-gray-900">Safety guardrails</summary>
        <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-700">{s.guardrails.map((g: string) => <li key={g}>{g}</li>)}</ul>
      </details>

      {sessionsToShow.map(k => (
        <SessionCard key={k} k={k} sess={s.plan[k]} planned={s.week.planned.includes(k)} program={p} canRecord={canRecord && p.status === 'active'} canDecide={canDecide && p.status !== 'completed'}
          logging={logging === k} onLog={() => setLogging(logging === k ? null : k)} act={act} base={base} onLogged={() => { setLogging(null); reload() }} setError={setError} />
      ))}

      <AdvancePanel s={s} canDecide={canDecide} act={act} base={base} />
      <AssessPanel s={s} canRecord={canRecord && p.status !== 'completed'} act={act} base={base} />
      <History s={s} />
      {canDecide && p.status !== 'completed' && <Controls s={s} act={act} base={base} />}
    </>
  )
}

// Third-party posts, collapsed on purpose. They sit under a label that says BenchCoach has not reviewed them,
// so they are never mistaken for a recommendation inside the instructions. A coach opens the list deliberately.
function Refs({ refs }: { refs: Json[] }) {
  if (!refs.length) return null
  return (
    <details className="mt-2 text-xs text-gray-600" data-testid="references">
      <summary className="cursor-pointer select-none">Third-party references, not reviewed by BenchCoach ({refs.length})</summary>
      <p className="mt-1 italic">Not a recommendation and not approved. Watch before you use one.</p>
      <ul className="mt-1 space-y-1">
        {refs.map(r => (
          <li key={r.url} data-testid="reference">
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">{r.title}<ExternalLink size={12} /></a>{' '}
            <span>by {r.creator}</span>{' '}
            <span className="rounded bg-gray-100 px-1.5 py-0.5">External reference · not yet reviewed</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function SessionCard({ k, sess, planned, program, canRecord, canDecide, logging, onLog, act, base, onLogged, setError }: Json) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section className={cls.card} data-testid={`session-${k}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className={cls.h2}>{sess.title}{!planned && <span className="ml-2 text-xs font-normal text-gray-500">not scheduled this week</span>}</h2>
          <p className="text-sm text-gray-600">{sess.theme}</p></div>
        {canRecord && <button className={cls.btn} onClick={onLog} data-testid={`log-${k}`}>{logging ? 'Close' : 'Log this session'}</button>}
      </div>
      <p className="mt-3 text-sm text-gray-700"><strong>Warm-up.</strong> {sess.warmup}</p>
      <ol className="mt-3 space-y-4">
        {sess.items.map((i: Json) => (
          <li key={i.exercise} className="text-sm" data-testid={`item-${k}-${i.exercise}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-gray-900">{i.name}{i.optional && <span className="ml-2 text-xs text-gray-500">optional</span>}{i.modified && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">coach-adjusted</span>}</span>
              <span className="text-gray-700">{i.sets} × {i.reps} {i.repsLabel} · rest {i.restText}</span>
            </div>
            <p className="text-gray-700 mt-1"><strong>Cue.</strong> {i.cue}</p>
            {i.commonError && <p className="text-gray-600"><strong>Watch for.</strong> {i.commonError}</p>}
            {i.indoorText && <p className="text-gray-700 mt-1" data-testid="indoor-sub"><strong>Indoor space.</strong> {i.indoorText}</p>}
            {i.note && <p className="text-gray-600 mt-1">{i.note}</p>}
            <p className="text-xs text-gray-500 mt-1">{i.drill.label}</p>
            <Refs refs={i.references} />
            {canDecide && <button className="mt-1 text-xs text-blue-700 underline" onClick={() => setEditing(editing === i.exercise ? null : i.exercise)}>{editing === i.exercise ? 'Close' : 'Adjust'}</button>}
            {editing === i.exercise && <Adjust item={i} session={k} act={act} base={base} done={() => setEditing(null)} />}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-gray-700"><strong>Cool-down.</strong> {sess.cooldown}</p>
      {logging && <LogForm k={k} sess={sess} program={program} base={base} onLogged={onLogged} setError={setError} />}
    </section>
  )
}

function Adjust({ item, session, act, base, done }: Json) {
  const [sets, setSets] = useState(String(item.sets)); const [reps, setReps] = useState(String(item.reps)); const [note, setNote] = useState('')
  const [url, setUrl] = useState(''); const [creator, setCreator] = useState(''); const [title, setTitle] = useState('')
  const send = async (adjustment: Json) => { const r = await act(base, 'PATCH', { action: 'adjust', adjustment }); if (r.ok) done() }
  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-3 space-y-3" data-testid={`adjust-${item.exercise}`}>
      <div className="flex flex-wrap gap-2 items-end">
        <div><label className="block text-xs text-gray-600">Sets</label><input aria-label="Sets" className="w-16 rounded border px-2 py-1" value={sets} onChange={e => setSets(e.target.value)} /></div>
        <div><label className="block text-xs text-gray-600">Reps</label><input aria-label="Reps" className="w-20 rounded border px-2 py-1" value={reps} onChange={e => setReps(e.target.value)} /></div>
        <div className="grow"><label className="block text-xs text-gray-600">Note</label><input aria-label="Note" maxLength={200} className="w-full rounded border px-2 py-1" value={note} onChange={e => setNote(e.target.value)} /></div>
        <button className={cls.ghost} onClick={() => send({ kind: 'exercise', session, exercise: item.exercise, set: { sets: parseInt(sets, 10), reps: /^\d+$/.test(reps) ? parseInt(reps, 10) : reps, ...(note ? { note } : {}) } })}>Save change</button>
        {!item.exercise.startsWith('warmup') && <button className={cls.ghost} onClick={() => send({ kind: 'exercise', session, exercise: item.exercise, remove: true })}>Remove from this session</button>}
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-medium text-gray-700">Video reference</p>
        <div className="flex flex-wrap gap-2 mt-1">
          {item.references.length > 0 && <button className={cls.ghost} onClick={() => send({ kind: 'reference', exercise: item.exercise, action: 'hide' })}>Remove reference</button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 mt-2">
          <input aria-label="Reference link" placeholder="https://… (Instagram or YouTube)" className="rounded border px-2 py-1 text-xs" value={url} onChange={e => setUrl(e.target.value)} />
          <input aria-label="Reference creator" placeholder="Creator (credit)" className="rounded border px-2 py-1 text-xs" value={creator} onChange={e => setCreator(e.target.value)} />
          <input aria-label="Reference title" placeholder="Title" className="rounded border px-2 py-1 text-xs" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <button className={`${cls.ghost} mt-2`} onClick={() => send({ kind: 'reference', exercise: item.exercise, action: 'replace', url, creator, title })}>Replace reference</button>
      </div>
    </div>
  )
}

function Score({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-1">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {[0, 1, 2].map(n => (
          <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(value === n ? null : n)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${value === n ? 'border-red-600 bg-red-50 text-red-800' : 'border-gray-300 text-gray-700'}`}>{SCORE_HELP[n]}</button>
        ))}
        <span className="self-center text-xs text-gray-500">{value === null ? 'not observed' : ''}</span>
      </div>
    </div>
  )
}

function LogForm({ k, sess, program, base, onLogged, setError }: Json) {
  const today = new Date().toISOString().slice(0, 10)
  const [status, setStatus] = useState<'completed' | 'skipped'>('completed')
  const [skipReason, setSkipReason] = useState('game')
  const [date, setDate] = useState(today)
  const [performed, setPerformed] = useState<Json[]>(sess.items.filter((i: Json) => !i.locked && !i.optional).map((i: Json) => ({ exercise: i.exercise, sets_done: i.sets, reps_done: String(i.reps), skipped: false })))
  const [scores, setScores] = useState<Record<string, number | null>>({ landing: null, braking: null, reaction: null })
  const [fatigue, setFatigue] = useState('some'); const [effort, setEffort] = useState('just_right')
  const [pain, setPain] = useState(false); const [painNote, setPainNote] = useState(''); const [cue, setCue] = useState(''); const [adj, setAdj] = useState(''); const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const setP = (i: number, patch: Json) => setPerformed(performed.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  async function submit() {
    setBusy(true); setError(null)
    const common = { week: program.currentWeek, session_key: k, occurred_on: date, pain_flag: pain, pain_note: pain ? painNote : null }
    const body = status === 'skipped'
      ? { ...common, status, skip_reason: skipReason }
      : { ...common, status, performed: performed.map(p => ({ ...p, sets_done: Number(p.sets_done) || 0 })), fatigue, effort, ...scores, first_step_cue: cue || null, adjustments_note: adj || null, coach_notes: notes || null }
    const r = await call(`${base}/sessions`, 'POST', body)
    setBusy(false)
    if (!r.ok) setError(r.data?.error || 'Could not save.')
    else onLogged()
  }

  return (
    <div className="mt-4 border-t pt-4 space-y-4" data-testid={`log-form-${k}`}>
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className={cls.label} htmlFor={`d-${k}`}>Date</label><input id={`d-${k}`} type="date" max={today} className={cls.input} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="flex gap-2" role="radiogroup" aria-label="Outcome">
          {(['completed', 'skipped'] as const).map(o => <button key={o} type="button" role="radio" aria-checked={status === o} onClick={() => setStatus(o)} className={`rounded-lg border px-3 py-1.5 text-sm ${status === o ? 'border-red-600 bg-red-50' : 'border-gray-300'}`}>{o === 'completed' ? 'Completed' : 'Skipped'}</button>)}
        </div>
        {status === 'skipped' && <div><label className={cls.label} htmlFor={`sr-${k}`}>Why</label>
          <select id={`sr-${k}`} className={cls.input} value={skipReason} onChange={e => setSkipReason(e.target.value)}>{['game', 'practice', 'sick', 'travel', 'weather', 'space', 'other'].map(r => <option key={r}>{r}</option>)}</select></div>}
      </div>
      {status === 'completed' && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">What was done</p>
            {performed.map((pf, i) => {
              const it = sess.items.find((x: Json) => x.exercise === pf.exercise)
              return (
                <div key={pf.exercise} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="inline-flex items-center gap-2 grow min-w-[10rem]"><input type="checkbox" checked={!pf.skipped} onChange={e => setP(i, { skipped: !e.target.checked })} />{it?.name}</label>
                  <input aria-label={`${it?.name} sets done`} className="w-14 rounded border px-2 py-1" value={pf.sets_done} onChange={e => setP(i, { sets_done: e.target.value })} />
                  <span>×</span>
                  <input aria-label={`${it?.name} reps done`} className="w-20 rounded border px-2 py-1" value={pf.reps_done} onChange={e => setP(i, { reps_done: e.target.value })} />
                </div>
              )
            })}
          </div>
          <p className="text-sm text-gray-600">Score only what you watched. Leave a score blank if you did not observe it.</p>
          {(['reaction', 'braking', 'landing'] as const).filter(kind => sess.observes.includes(kind)).map(kind => (
            <Score key={kind} label={KIND_LABEL[kind]} value={scores[kind]} onChange={v => setScores({ ...scores, [kind]: v })} />
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={cls.label} htmlFor={`f-${k}`}>Fatigue</label><select id={`f-${k}`} className={cls.input} value={fatigue} onChange={e => setFatigue(e.target.value)}><option value="none">None</option><option value="some">Some</option><option value="high">High</option></select></div>
            <div><label className={cls.label} htmlFor={`e-${k}`}>Effort</label><select id={`e-${k}`} className={cls.input} value={effort} onChange={e => setEffort(e.target.value)}><option value="easy">Easy</option><option value="just_right">Just right</option><option value="hard">Hard</option></select></div>
            <div className="sm:col-span-2"><label className={cls.label} htmlFor={`c-${k}`}>Coaching cue that worked</label><input id={`c-${k}`} maxLength={300} className={cls.input} value={cue} onChange={e => setCue(e.target.value)} /></div>
            <div className="sm:col-span-2"><label className={cls.label} htmlFor={`a-${k}`}>Adjustments made</label><input id={`a-${k}`} maxLength={300} className={cls.input} value={adj} onChange={e => setAdj(e.target.value)} /></div>
            <div className="sm:col-span-2"><label className={cls.label} htmlFor={`n-${k}`}>Notes</label><textarea id={`n-${k}`} maxLength={500} rows={2} className={cls.input} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        </>
      )}
      <div className="rounded-lg bg-amber-50 p-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-amber-900"><input type="checkbox" checked={pain} onChange={e => setPain(e.target.checked)} data-testid="pain-flag" />Pain, dizziness or a sudden drop in form</label>
        {pain && <input aria-label="Pain note" maxLength={300} placeholder="Where, and what happened" className={`${cls.input} mt-2`} value={painNote} onChange={e => setPainNote(e.target.value)} />}
      </div>
      <button className={cls.btn} disabled={busy} onClick={submit} data-testid={`save-${k}`}>{busy && <Loader2 className="animate-spin" size={16} />}Save session</button>
    </div>
  )
}

// ── advancing ───────────────────────────────────────────────────────────────

function AdvanceRow({ title, detail, el, body, act, base, disabledReason }: Json) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState('')
  const pain = el.blocked === 'pain'
  return (
    <li className="py-3 text-sm" data-testid={`advance-${body.kind}${body.key ? `-${body.key}` : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-medium text-gray-900">{title}</p><p className="text-gray-600">{detail}</p>
          <p className={el.eligible ? 'text-green-800' : 'text-gray-700'}>{el.eligible ? <><Check size={14} className="inline mr-1" />Ready: {el.reasons[0]}</> : el.reasons.join(' ')}</p></div>
        {disabledReason ? <span className="text-xs text-gray-500">{disabledReason}</span>
          : el.eligible
            ? <button className={cls.btn} onClick={() => act(`${base}/advance`, 'POST', body)}>Advance</button>
            : pain ? <span className="text-xs text-amber-800">Blocked until a pain-free session is logged.</span>
            : <button className={cls.ghost} onClick={() => setOpen(!open)}>Coach override…</button>}
      </div>
      {open && !el.eligible && !pain && (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-gray-600" htmlFor={`ov-${title}`}>Why is this safe to do now? This is recorded with your name.</label>
          <textarea id={`ov-${title}`} rows={2} maxLength={300} className={cls.input} value={reason} onChange={e => setReason(e.target.value)} />
          <button className={cls.btn} disabled={reason.trim().length < 10} onClick={() => act(`${base}/advance`, 'POST', { ...body, override: true, reason })}>Advance with override</button>
        </div>
      )}
    </li>
  )
}

function AdvancePanel({ s, canDecide, act, base }: Json) {
  const p = s.program
  if (p.status === 'completed') return null
  return (
    <section className={cls.card} data-testid="advance-panel">
      <h2 className={cls.h2}>Moving on</h2>
      <p className="text-sm text-gray-600 mt-1">Progress needs controlled landings, braking and reactions in two sessions. Nothing advances on its own, and one harder step is made per week.</p>
      {!canDecide ? <p className="text-sm text-gray-600 mt-2">Only a head coach or admin can advance a player.</p> : (
        <ul className="divide-y mt-2">
          {p.currentWeek < 4 && <AdvanceRow title={`Move to week ${p.currentWeek + 1}`} detail="Two completed sessions since the last advance, with no pain and no poor control." el={s.eligibility.week} body={{ kind: 'week' }} act={act} base={base} />}
          {s.eligibility.nextLevel && <AdvanceRow title={`Move up to ${LEVEL_DEFS[s.eligibility.nextLevel as 'advanced'].label}`} detail="Needs landing, braking and reaction all observed and controlled." el={s.eligibility.level} body={{ kind: 'level' }} act={act} base={base} disabledReason={p.currentWeek < 3 ? 'From Week 3' : null} />}
          {s.progressions.filter((x: Json) => !x.unlocked).map((x: Json) => (
            <AdvanceRow key={x.key} title={`Unlock: ${x.label}`} detail={x.description} el={x.eligibility} body={{ kind: 'unlock', key: x.key }} act={act} base={base}
              disabledReason={p.level === 'foundation' && (x.key === 'skater_hop' || x.key === 'broad_jump_to_sprint') ? 'Move to Development first' : x.outdoorOnly && p.space !== 'outdoor_open' ? 'Needs open outdoor space' : x.key === 'single_leg_hops' && p.level !== 'advanced' ? 'Advanced level only' : x.key === 'broad_jump_to_sprint' && p.currentWeek < 3 ? 'From week 3' : x.key === 'reactive_partner_cues' && p.currentWeek < 2 ? 'From week 2' : null} />
          ))}
        </ul>
      )}
      {p.unlocks.length > 0 && <p className="text-sm text-gray-700 mt-2">Unlocked: {p.unlocks.join(', ')}</p>}
    </section>
  )
}

// ── assessments ─────────────────────────────────────────────────────────────

function AssessPanel({ s, canRecord, act, base }: Json) {
  const p = s.program
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('baseline'); const [method, setMethod] = useState('rubric'); const [metric, setMetric] = useState('sprint_10y')
  const [value, setValue] = useState(''); const [rub, setRub] = useState<Record<string, number | null>>({ landing: null, braking: null, reaction: null })
  const [c, setC] = useState({ location: 'outdoor_open', surface: 'grass', timing_method: 'stopwatch', start_type: 'standing_start', distance_yards: 10 })
  const date = new Date().toISOString().slice(0, 10)
  const timedAllowed = p.level !== 'foundation' && p.space === 'outdoor_open'
  const save = async () => {
    const body: Json = { kind, method, occurred_on: date }
    if (method === 'timed') Object.assign(body, { metric_slug: metric, value: parseFloat(value), conditions: { ...c, distance_yards: metric === 'sprint_10y' ? 10 : c.distance_yards } })
    else body.rubric = rub
    const r = await act(`${base}/assessments`, 'POST', body)
    if (r.ok) { setOpen(false); setValue('') }
  }
  return (
    <section className={cls.card} data-testid="assess-panel">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={cls.h2}>Baseline and retest</h2>
        {canRecord && <button className={cls.ghost} onClick={() => setOpen(!open)} data-testid="assess-open">{open ? 'Close' : 'Add a result'}</button>}</div>
      <p className="text-sm text-gray-600 mt-1">Optional. Results are compared only when taken under the same conditions. No verdict is given.</p>
      {s.assessments.length === 0 && <p className="text-sm text-gray-600 mt-2">No results recorded.</p>}
      {s.assessments.map((g: Json) => (
        <div key={g.key} className="mt-3 text-sm" data-testid="assess-group">
          <p className="font-medium text-gray-900">{g.baseline?.metric_slug === 'sprint_10y' ? '10-yard sprint' : g.baseline?.metric_slug === 'home_to_first' ? 'Home to first' : g.key.startsWith('rubric') ? 'Movement quality (0–2)' : g.key}</p>
          {g.baseline && <p className="text-gray-700">Baseline {g.baseline.occurred_on}: {g.baseline.method === 'timed' ? `${g.baseline.value} s` : Object.entries(g.baseline.rubric).map(([k, v]) => `${KIND_LABEL[k] || k} ${v}`).join(', ')}</p>}
          {g.retests.map((rt: Json) => (
            <p key={rt.record.id} className="text-gray-700" data-testid="retest">Retest {rt.record.occurred_on}: {rt.record.method === 'timed' ? `${rt.record.value} s` : Object.entries(rt.record.rubric).map(([k, v]) => `${KIND_LABEL[k] || k} ${v}`).join(', ')}
              {' · '}{rt.comparison.comparable
                ? (typeof rt.comparison.delta === 'number' ? `change ${rt.comparison.delta > 0 ? '+' : ''}${rt.comparison.delta} s` : `change ${Object.entries(rt.comparison.delta).map(([k, v]: any) => `${KIND_LABEL[k] || k} ${v > 0 ? '+' : ''}${v}`).join(', ')}`)
                : <span className="text-amber-800">not compared. {rt.comparison.reasons.join(' ')}</span>}</p>
          ))}
        </div>
      ))}
      {open && (
        <div className="mt-4 border-t pt-4 space-y-3" data-testid="assess-form">
          <div className="flex flex-wrap gap-3">
            <div><label className={cls.label} htmlFor="ak">Which</label><select id="ak" className={cls.input} value={kind} onChange={e => setKind(e.target.value)}><option value="baseline">Baseline</option><option value="retest">Retest</option></select></div>
            <div><label className={cls.label} htmlFor="am">Type</label><select id="am" className={cls.input} value={method} onChange={e => setMethod(e.target.value)}><option value="rubric">Movement quality (0–2)</option>{timedAllowed && <option value="timed">Timed</option>}</select></div>
          </div>
          {!timedAllowed && <p className="text-xs text-gray-600">{p.level === 'foundation' ? 'Foundation uses the movement-quality rubric only.' : 'Timed tests need open outdoor space; the small indoor space is not used for sprints.'}</p>}
          {method === 'rubric'
            ? (['landing', 'braking', 'reaction'] as const).map(kk => <Score key={kk} label={KIND_LABEL[kk]} value={rub[kk]} onChange={v => setRub({ ...rub, [kk]: v })} />)
            : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className={cls.label} htmlFor="mt">Measure</label><select id="mt" className={cls.input} value={metric} onChange={e => { setMetric(e.target.value); if (e.target.value === 'home_to_first') setC({ ...c, location: 'field', distance_yards: 20 }) }}><option value="sprint_10y">10-yard sprint</option><option value="home_to_first">Home to first</option></select></div>
                <div><label className={cls.label} htmlFor="mv">Time (seconds)</label><input id="mv" inputMode="decimal" className={cls.input} value={value} onChange={e => setValue(e.target.value)} /></div>
                <div><label className={cls.label} htmlFor="ml">Where</label><select id="ml" className={cls.input} value={c.location} onChange={e => setC({ ...c, location: e.target.value })}><option value="outdoor_open">Open outdoor</option><option value="field">Baseball field</option></select></div>
                <div><label className={cls.label} htmlFor="ms">Surface</label><select id="ms" className={cls.input} value={c.surface} onChange={e => setC({ ...c, surface: e.target.value })}>{['grass', 'turf', 'dirt', 'track', 'other'].map(x => <option key={x}>{x}</option>)}</select></div>
                <div><label className={cls.label} htmlFor="mm">Timing method</label><select id="mm" className={cls.input} value={c.timing_method} onChange={e => setC({ ...c, timing_method: e.target.value })}>{['stopwatch', 'phone_video', 'timing_gates', 'other'].map(x => <option key={x}>{x}</option>)}</select></div>
                <div><label className={cls.label} htmlFor="mst">Start</label><select id="mst" className={cls.input} value={c.start_type} onChange={e => setC({ ...c, start_type: e.target.value })}>{['standing_start', 'three_point', 'falling_start', 'batting_stance', 'other'].map(x => <option key={x}>{x}</option>)}</select></div>
              </div>
            )}
          <button className={cls.btn} onClick={save} data-testid="assess-save">Save result</button>
        </div>
      )}
    </section>
  )
}

// ── history and controls ────────────────────────────────────────────────────

function History({ s }: Json) {
  return (
    <section className={cls.card} data-testid="history">
      <h2 className={cls.h2}>History</h2>
      {s.sessions.length === 0 ? <p className="text-sm text-gray-600 mt-2">No sessions logged yet.</p> : (
        <ul className="mt-2 divide-y text-sm">
          {s.sessions.map((x: Json) => (
            <li key={x.id} className="py-2" data-testid="history-session">
              <span className="font-medium">{x.occurred_on} · Week {x.week} · Session {x.session_key}</span>{' '}
              {x.status === 'skipped' ? <span className="text-gray-600">skipped ({x.skip_reason})</span>
                : <span className="text-gray-700">{[['landing', x.landing], ['braking', x.braking], ['reaction', x.reaction]].filter(([, v]) => v !== null).map(([k, v]) => `${KIND_LABEL[k as string]} ${v}`).join(' · ') || 'no scores'}{x.fatigue ? ` · fatigue ${x.fatigue}` : ''}</span>}
              {x.pain_flag && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">pain reported{x.pain_note ? `: ${x.pain_note}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
      {s.events.length > 0 && (
        <details className="mt-3"><summary className="cursor-pointer text-sm text-gray-700">Coach decisions ({s.events.length})</summary>
          <ul className="mt-2 text-xs text-gray-600 space-y-1">{s.events.map((e: Json) => <li key={e.id}>{String(e.occurred_at).slice(0, 10)} · {e.event_type}{e.detail?.kind ? ` ${e.detail.kind}${e.detail.key ? ` ${e.detail.key}` : ''}` : ''}{e.detail?.override ? ' (override)' : ''}{e.reason ? ` — ${e.reason}` : ''}</li>)}</ul></details>
      )}
    </section>
  )
}

function Controls({ s, act, base }: Json) {
  const p = s.program
  return (
    <section className={`${cls.card} flex flex-wrap items-end gap-3`} data-testid="controls">
      <div><label className={cls.label} htmlFor="cd">Sessions per week</label>
        <select id="cd" className={cls.input} value={p.daysPerWeek} onChange={e => act(base, 'PATCH', { action: 'schedule', daysPerWeek: parseInt(e.target.value, 10) })}>{[1, 2, 3].map(d => <option key={d}>{d}</option>)}</select></div>
      <div><label className={cls.label} htmlFor="cs">Space</label>
        <select id="cs" className={cls.input} value={p.space} onChange={e => act(base, 'PATCH', { action: 'space', space: e.target.value })}><option value="outdoor_open">Open outdoor</option><option value="indoor_small">Indoor, about 20×15 ft</option></select></div>
      {p.status === 'active' && <button className={cls.ghost} onClick={() => act(base, 'PATCH', { action: 'pause' })}>Pause</button>}
      {p.status === 'paused' && <button className={cls.btn} onClick={() => act(base, 'PATCH', { action: 'resume' })}>Resume</button>}
      <button className={cls.ghost} onClick={() => { if (confirm('Finish this program? Its history stays on the player.')) act(base, 'PATCH', { action: 'complete' }) }}>Finish program</button>
    </section>
  )
}
