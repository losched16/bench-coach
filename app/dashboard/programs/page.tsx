'use client'

// Development Programs: the list, and the "Create Development Program" form.
// The form and CoachAI both end up in the same generator.

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useRole } from '@/lib/useRole'
import { prettyDate, SKILL_LABEL } from '@/components/programs/parts'
import { SKILL_KEYS } from '@/lib/programs/types'

export default function ProgramsPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const teamId = sp.get('teamId')
  const { can } = useRole(teamId)
  const [programs, setPrograms] = useState<any[]>([])
  const [drafts, setDrafts] = useState<any[]>([])
  const [roster, setRoster] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<string[]>([])

  const [playerId, setPlayerId] = useState(sp.get('playerId') || '')
  const [skills, setSkills] = useState<string[]>([])
  const [weeks, setWeeks] = useState('8')
  const [startDate, setStartDate] = useState('')
  const [days, setDays] = useState('4')
  const [minutes, setMinutes] = useState('60')
  const [indep, setIndep] = useState('10')
  const [equipment, setEquipment] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!teamId) { setLoading(false); return }
    ;(async () => {
      const res = await fetch(`/api/development-program?teamId=${teamId}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setError(res.status === 404 ? 'Development Programs are not switched on for this account yet.' : d.error || 'Could not load programs.')
      else { setPrograms(d.programs || []); setDrafts(d.drafts || []) }
      const supabase = createSupabaseComponentClient()
      const { data } = await supabase.from('team_players').select('player:players(id, name)').eq('team_id', teamId as any)
      setRoster((data || []).map((r: any) => r.player).filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name)))
      setLoading(false)
    })()
  }, [teamId])

  async function create() {
    setBusy(true); setError(null); setQuestions([])
    const overrides: any = {}
    if (skills.length) overrides.skills = skills
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

  if (!teamId) return <p className="p-4 text-sm text-red-700">Pick a team first.</p>
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-400" size={32} aria-label="Loading" /></div>
  const q = `?teamId=${teamId}`
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name || 'Player'

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Development Programs</h1>
      <p className="text-sm text-gray-700">A program turns a player’s development into scheduled, runnable training. Playbooks teach a skill and Development Plans track where a player is; a program organises the next weeks. You can also just ask CoachAI.</p>
      {error && <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded p-2">{error}</p>}

      {drafts.length > 0 && <section><h2 className="font-semibold text-gray-900 mb-1">Drafts waiting for review</h2><ul className="space-y-1">{drafts.map(d => (
        <li key={d.id}><Link className="underline text-red-700 min-h-[44px] inline-flex items-center" href={`/dashboard/programs/draft/${d.id}${q}`}>{nameOf(d.player_id)} — {(d as any).title || 'program draft'}</Link></li>))}</ul></section>}

      <section><h2 className="font-semibold text-gray-900 mb-1">Programs</h2>
        {programs.length === 0 ? <p className="text-sm text-gray-600">No programs yet.</p> : (
          <ul className="space-y-2">{programs.map(p => (
            <li key={p.id} className="bg-white border border-gray-200 rounded-xl p-3"><Link className="font-medium text-red-700 underline" href={`/dashboard/programs/${p.id}${q}`}>{p.title}</Link>
              <p className="text-xs text-gray-600">{nameOf(p.player_id)} · {prettyDate(p.start_date)} – {prettyDate(p.end_date)} · {p.status}</p></li>))}</ul>)}</section>

      {can('ask') && (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <button type="button" onClick={() => setCreating(c => !c)} aria-expanded={creating} className="font-semibold text-gray-900 min-h-[44px]">Create Development Program {creating ? '▾' : '▸'}</button>
          {creating && (
            <div className="space-y-3 mt-2 text-sm">
              <label className="block">Player<select className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={playerId} onChange={e => setPlayerId(e.target.value)}><option value="">Choose…</option>{roster.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <fieldset><legend className="font-medium">Skills to develop (all of them are kept)</legend><div className="flex flex-wrap gap-2 mt-1">{SKILL_KEYS.map(k => (
                <label key={k} className={`px-3 min-h-[44px] inline-flex items-center rounded-lg border cursor-pointer ${skills.includes(k) ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300'}`}>
                  <input type="checkbox" className="sr-only" checked={skills.includes(k)} onChange={e => setSkills(s => e.target.checked ? [...s, k] : s.filter(x => x !== k))} />{SKILL_LABEL[k]}</label>))}</div></fieldset>
              <div className="grid grid-cols-2 gap-3">
                <label>Weeks<input inputMode="numeric" className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={weeks} onChange={e => setWeeks(e.target.value)} /></label>
                <label>Start date<input type="date" className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
                <label>Supervised days a week<input inputMode="numeric" className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={days} onChange={e => setDays(e.target.value)} /></label>
                <label>Minutes per session<input inputMode="numeric" className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
                <label>Independent routine (minutes, 0 for none)<input inputMode="numeric" className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={indep} onChange={e => setIndep(e.target.value)} /></label>
              </div>
              <label className="block">Equipment you have (comma separated)<input className="block w-full border border-gray-300 rounded min-h-[44px] px-2" value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="batting tee, net, resistance bands" /></label>
              <label className="block">Anything else CoachAI should know (concerns, arm status, tryout dates)<textarea className="block w-full border border-gray-300 rounded p-2" rows={4} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
              {questions.length > 0 && <ul className="list-disc pl-5 text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">{questions.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              <button type="button" onClick={create} disabled={busy || !playerId} className="inline-flex items-center gap-2 px-5 min-h-[48px] rounded-lg bg-red-700 text-white font-medium disabled:opacity-60">{busy && <Loader2 className="animate-spin" size={16} aria-hidden />}Build the program draft</button>
              <p className="text-xs text-gray-600">This takes up to a minute. You review and edit everything before anything is saved.</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
