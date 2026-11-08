'use client'

// The "Training programs" half of the Development page, and the one place a
// coach starts something new.
//
// Two needs, one front door:
//   * "I just want to work on one skill" — a skill path (self-paced stages) or a
//     short scheduled program for that one skill.
//   * "Build a full development program" — several skills over weeks.
//
// Both scheduled options go through the same generator as CoachAI.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useRole } from '@/lib/useRole'
import { prettyDate, SKILL_LABEL, today } from '@/components/programs/parts'
import { SKILL_KEYS } from '@/lib/programs/types'
import { developmentPlanLink } from '@/lib/programChoice'

type Mode = 'one' | 'full'

export default function ProgramsHub({ teamId, initialPlayerId }: { teamId: string; initialPlayerId?: string | null }) {
  const router = useRouter()
  const { can } = useRole(teamId)
  const [programs, setPrograms] = useState<any[]>([])
  const [drafts, setDrafts] = useState<any[]>([])
  const [todays, setTodays] = useState<Array<{ programId: string; sessionId: string; title: string }>>([])
  const [roster, setRoster] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [off, setOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<string[]>([])

  const [playerId, setPlayerId] = useState(initialPlayerId || '')
  const [skills, setSkills] = useState<string[]>([])
  const [oneSkill, setOneSkill] = useState('hitting')
  const [weeks, setWeeks] = useState('8')
  const [startDate, setStartDate] = useState('')
  const [days, setDays] = useState('4')
  const [minutes, setMinutes] = useState('60')
  const [indep, setIndep] = useState('10')
  const [equipment, setEquipment] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/development-program?teamId=${teamId}`)
      const d = await res.json().catch(() => ({}))
      if (cancelled) return
      if (res.status === 404) setOff(true)
      else if (!res.ok) setError(d.error || 'Could not load programs.')
      else {
        setPrograms(d.programs || []); setDrafts(d.drafts || [])
        const active = (d.programs || []).find((p: any) => p.status === 'active')
        if (active) {
          const r = await fetch(`/api/development-program?teamId=${teamId}&programId=${active.id}`)
          const detail = await r.json().catch(() => ({}))
          const t = today()
          if (r.ok && !cancelled) setTodays((detail.sessions || []).filter((s: any) => s.scheduled_date === t && s.kind !== 'rest' && s.status === 'planned')
            .sort((a: any, b: any) => Number(a.kind === 'independent') - Number(b.kind === 'independent'))
            .map((s: any) => ({ programId: active.id, sessionId: s.id, title: s.title })))
        }
      }
      const supabase = createSupabaseComponentClient()
      const { data } = await supabase.from('team_players').select('player:players(id, name)').eq('team_id', teamId as any)
      const list = (data || []).map((r: any) => r.player).filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name))
      if (!cancelled) { setRoster(list); if (!initialPlayerId && list.length === 1) setPlayerId(list[0].id); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [teamId, initialPlayerId])

  const nameOf = (id: string) => roster.find(r => r.id === id)?.name || 'Player'
  const q = `?teamId=${teamId}`
  const pathStart = useMemo(() => developmentPlanLink(teamId, playerId || null), [teamId, playerId])

  function choose(m: Mode) {
    setMode(m); setQuestions([]); setError(null)
    if (m === 'one') { setWeeks('4'); setDays('3'); setMinutes('45'); setIndep('0') }
    else { setWeeks('8'); setDays('4'); setMinutes('60'); setIndep('10') }
  }

  async function create() {
    setBusy(true); setError(null); setQuestions([])
    const overrides: any = {}
    const chosen = mode === 'one' ? [oneSkill] : skills
    if (chosen.length) overrides.skills = chosen
    if (weeks) overrides.weeks = Number(weeks)
    if (startDate) overrides.startDate = startDate
    overrides.supervisedDaysPerWeek = Number(days); overrides.sessionMinutes = Number(minutes); overrides.independentMinutes = Number(indep)
    if (equipment.trim()) overrides.equipment = equipment.split(',').map(x => x.trim()).filter(Boolean)
    const res = await fetch('/api/development-program/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId, playerId, message: notes, overrides }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error || 'Could not build the program.'); return }
    if (d.status === 'needs_info') { setQuestions(d.questions); return }
    router.push(`/dashboard/programs/draft/${d.draftId}?teamId=${teamId}`)
  }

  if (off) return null
  if (loading) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="animate-spin" size={16} aria-hidden /> Loading programs…</div>

  const field = 'block w-full border border-gray-300 rounded min-h-[44px] px-2'
  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded p-2">{error}</p>}

      {todays.length > 0 && (
        <section aria-label="Today" className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <span className="font-medium text-red-900">Today’s workout</span>
          {todays.map(t => (
            <Link key={t.sessionId} href={`/dashboard/programs/${t.programId}/session/${t.sessionId}${q}`}
              className="inline-flex items-center min-h-[44px] px-4 rounded-lg bg-red-700 text-white text-sm font-medium">{t.title}</Link>
          ))}
        </section>
      )}

      <section aria-labelledby="start-heading">
        <h3 id="start-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Start something new</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <button type="button" onClick={() => choose('one')} aria-pressed={mode === 'one'}
            className={`text-left rounded-xl border p-4 min-h-[44px] ${mode === 'one' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <span className="block font-semibold text-gray-900">Work on one skill</span>
            <span className="block text-sm text-gray-600 mt-1">For example, a power-hitting plan. Go at your own pace, or get a short scheduled program.</span>
          </button>
          <button type="button" onClick={() => choose('full')} aria-pressed={mode === 'full'}
            className={`text-left rounded-xl border p-4 min-h-[44px] ${mode === 'full' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <span className="block font-semibold text-gray-900">Full development program</span>
            <span className="block text-sm text-gray-600 mt-1">Several skills over weeks, with a schedule, rest days, measurements and daily workouts.</span>
          </button>
        </div>

        {mode && can('ask') && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3 space-y-3 text-sm">
            <label className="block">Player<select className={field} value={playerId} onChange={e => setPlayerId(e.target.value)}><option value="">Choose…</option>{roster.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>

            {mode === 'one' ? (
              <>
                <label className="block">Which skill?<select className={field} value={oneSkill} onChange={e => setOneSkill(e.target.value)}>{SKILL_KEYS.map(k => <option key={k} value={k}>{SKILL_LABEL[k]}</option>)}</select></label>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                  <p className="font-medium text-gray-900">How do you want to work on it?</p>
                  <p className="text-gray-700"><b>Self-paced skill path.</b> Stages you move through when the player is ready. No schedule.</p>
                  <Link href={pathStart.href} className="inline-flex items-center min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white text-gray-900">
                    {playerId ? 'Open their skill paths' : 'Choose a player first, then skill paths'}
                  </Link>
                  <p className="text-gray-700 pt-1"><b>Short scheduled program.</b> A few weeks of dated workouts for this one skill, built below.</p>
                </div>
                <label className="block">What do you want out of it? (for example, “more power without pulling off the ball”)<textarea className="block w-full border border-gray-300 rounded p-2" rows={3} maxLength={600} value={notes} onChange={e => setNotes(e.target.value)} /></label>
                <fieldset><legend className="font-medium">Length</legend><div className="flex gap-2 mt-1">{['2', '4', '6'].map(w => (
                  <label key={w} className={`px-4 min-h-[44px] inline-flex items-center rounded-lg border cursor-pointer ${weeks === w ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300'}`}>
                    <input type="radio" className="sr-only" name="len" checked={weeks === w} onChange={() => setWeeks(w)} />{w} weeks</label>))}</div></fieldset>
                <label className="block">Days a week<input inputMode="numeric" className={field} value={days} onChange={e => setDays(e.target.value)} /></label>
              </>
            ) : (
              <>
                <fieldset><legend className="font-medium">Skills to develop (all of them are kept)</legend><div className="flex flex-wrap gap-2 mt-1">{SKILL_KEYS.map(k => (
                  <label key={k} className={`px-3 min-h-[44px] inline-flex items-center rounded-lg border cursor-pointer ${skills.includes(k) ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300'}`}>
                    <input type="checkbox" className="sr-only" checked={skills.includes(k)} onChange={e => setSkills(s => e.target.checked ? [...s, k] : s.filter(x => x !== k))} />{SKILL_LABEL[k]}</label>))}</div></fieldset>
                <div className="grid grid-cols-2 gap-3">
                  <label>Weeks<input inputMode="numeric" className={field} value={weeks} onChange={e => setWeeks(e.target.value)} /></label>
                  <label>Start date<input type="date" className={field} value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
                  <label>Supervised days a week<input inputMode="numeric" className={field} value={days} onChange={e => setDays(e.target.value)} /></label>
                  <label>Minutes per session<input inputMode="numeric" className={field} value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
                  <label>Independent routine (minutes, 0 for none)<input inputMode="numeric" className={field} value={indep} onChange={e => setIndep(e.target.value)} /></label>
                </div>
                <label className="block">Anything else CoachAI should know (concerns, arm status, tryout dates)<textarea className="block w-full border border-gray-300 rounded p-2" rows={4} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
              </>
            )}
            <label className="block">Equipment you have (comma separated)<input className={field} value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="batting tee, net, resistance bands" /></label>
            {questions.length > 0 && <ul className="list-disc pl-5 text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">{questions.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            <button type="button" onClick={create} disabled={busy || !playerId} className="inline-flex items-center gap-2 px-5 min-h-[48px] rounded-lg bg-red-700 text-white font-medium disabled:opacity-60">
              {busy && <Loader2 className="animate-spin" size={16} aria-hidden />}Build the program draft</button>
            <p className="text-xs text-gray-600">This takes up to a minute. You review and edit everything before anything is saved. You can also just ask CoachAI.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="programs-heading">
        <h3 id="programs-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Training programs</h3>
        {drafts.length > 0 && <ul className="mb-2 space-y-1">{drafts.map(d => (
          <li key={d.id}><Link className="underline text-red-700 min-h-[44px] inline-flex items-center" href={`/dashboard/programs/draft/${d.id}${q}`}>Draft for {nameOf(d.player_id)} — waiting for your review</Link></li>))}</ul>}
        {programs.length === 0 ? <p className="text-sm text-gray-600">No training programs yet.</p> : (
          <ul className="space-y-2">{programs.map(p => (
            <li key={p.id} className="bg-white border border-gray-200 rounded-xl p-3"><Link className="font-medium text-red-700 underline" href={`/dashboard/programs/${p.id}${q}`}>{p.title}</Link>
              <p className="text-xs text-gray-600">{nameOf(p.player_id)} · {prettyDate(p.start_date)} – {prettyDate(p.end_date)} · {p.status}</p></li>))}</ul>)}
      </section>
    </div>
  )
}
