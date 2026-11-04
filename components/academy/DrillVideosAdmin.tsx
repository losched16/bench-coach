'use client'

// Owner tool: put a library drill's video under an Academy lesson drill, watch it, then approve it.
// Nothing reaches a learner until a mapping is approved with a reviewer name and "I watched it all".

import { useCallback, useEffect, useState } from 'react'
import { DrillVideo } from '@/components/DrillVideo'

interface LessonDrill { lesson_key: string; number_label: string | null; lesson_title: string; label: string; name: string }
interface Library { name: string; videoId: string | null; channel: string | null; libraryStart: number | null; sharedBy: number; retired: boolean; pasted?: boolean }
interface Mapping { lesson_key: string; drill_label: string; drill_id: string; start_seconds: number | null; approval_status: string; reviewed_by: string | null; reviewed_at: string | null; library: Library | null }
interface Result { drill_id: string; name: string; hasVideo: boolean; videoId: string | null; channel: string | null; libraryStart: number | null; sharedBy: number }

const api = '/api/academy/admin/drill-videos'

function Row({ course, d, m, reload }: { course: string; d: LessonDrill; m?: Mapping; reload: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [start, setStart] = useState('')
  const [link, setLink] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [watched, setWatched] = useState(false)
  const [compilation, setCompilation] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    setMsg(null)
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course, lesson_key: d.lesson_key, label: d.label, action, ...extra }) })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? `Saved: ${j.status}` : j.error || 'Failed.')
    if (r.ok) { setResults([]); setQ(''); setLink(''); setWatched(false); setCompilation(false); reload() }
  }
  const search = async () => {
    const r = await fetch(`${api}?course=${course}&q=${encodeURIComponent(q)}`)
    const j = await r.json().catch(() => ({}))
    setResults(j.results || [])
    if (!(j.results || []).length) setMsg('No library drill matches that name.')
  }

  const lib = m?.library
  const startNow = m?.start_seconds ?? lib?.libraryStart ?? null
  const needsCompilationOk = !!lib && lib.sharedBy > 1 && startNow == null
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 space-y-2" data-testid="dv-row" data-drill={`${d.lesson_key}-${d.label}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">{d.label}</span>
        <span className="font-medium">{d.name}</span>
        <span className="ml-auto text-xs font-semibold uppercase tracking-wide" data-testid="dv-status">{m ? m.approval_status : 'no video'}</span>
      </div>
      {m && lib && (
        <div className="text-sm text-slate-700">
          {lib.pasted ? 'Pasted YouTube video' : 'Library drill'}: <strong>{lib.name}</strong>{lib.channel ? ` · ${lib.channel}` : ''}{lib.retired ? ' · RETIRED in the library' : ''}
          {lib.sharedBy > 1 && <span className="block text-amber-800">This video is used by {lib.sharedBy} library drills (a compilation).{startNow == null ? ' No start time is set.' : ` Starts at ${startNow}s.`}</span>}
          {m.approval_status === 'approved' && <span className="block text-emerald-800">Approved by {m.reviewed_by} on {String(m.reviewed_at).slice(0, 10)}.</span>}
        </div>
      )}
      {m && lib?.videoId && m.approval_status !== 'approved' && <DrillVideo drillName={lib.name} youtubeVideoId={lib.videoId} channel={lib.channel || undefined} startSeconds={startNow ?? undefined} compact />}
      {m && lib?.videoId && m.approval_status !== 'approved' && (
        <div className="space-y-2 rounded bg-slate-50 p-2 text-sm">
          <input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Reviewer name" className="w-full rounded border px-2 py-1" aria-label="Reviewer name" />
          <label className="flex items-start gap-2"><input type="checkbox" checked={watched} onChange={e => setWatched(e.target.checked)} /> <span>I watched the whole video and it is right for this drill, safe, and suitable for the age group.</span></label>
          {needsCompilationOk && <label className="flex items-start gap-2"><input type="checkbox" checked={compilation} onChange={e => setCompilation(e.target.checked)} /> <span>This video covers several drills and no start time is set. Opening it at the beginning is acceptable.</span></label>}
          <button onClick={() => post('approve', { reviewer, watched, acceptCompilation: compilation })} className="rounded bg-emerald-700 px-3 py-1.5 text-white" data-testid="dv-approve">Approve for learners</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the drill library" className="min-w-0 flex-1 rounded border px-2 py-1" aria-label="Search the drill library" />
        <input value={start} onChange={e => setStart(e.target.value)} placeholder="Start (sec)" inputMode="numeric" className="w-24 rounded border px-2 py-1" aria-label="Start second" />
        <button onClick={search} className="rounded bg-slate-800 px-3 py-1.5 text-white" data-testid="dv-search">Search</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input value={link} onChange={e => setLink(e.target.value)} placeholder="No library video? Paste a YouTube link" inputMode="url" className="min-w-0 flex-1 rounded border px-2 py-1" aria-label="Paste a YouTube link" data-testid="dv-link" />
        <button onClick={() => post('map', { youtube_url: link, start_seconds: start || null })} disabled={!link.trim()} className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40" data-testid="dv-use-link">Use link</button>
      </div>
      {results.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="dv-results">
          {results.map(r => (
            <li key={r.drill_id} className="flex items-center gap-2">
              <span className="flex-1">{r.name}{r.channel ? ` · ${r.channel}` : ''}{!r.hasVideo ? ' · no YouTube video' : r.sharedBy > 1 ? ` · shared by ${r.sharedBy} drills` : ''}</span>
              <button disabled={!r.hasVideo} onClick={() => post('map', { drill_id: r.drill_id, start_seconds: start || null })} className="rounded border px-2 py-1 disabled:opacity-40" data-testid="dv-pick">Use this</button>
            </li>
          ))}
        </ul>
      )}
      {m && (
        <div className="flex gap-3 text-xs text-slate-600">
          {m.approval_status === 'approved' && <button onClick={() => post('retire')} className="underline">Retire</button>}
          <button onClick={() => post('reject')} className="underline">Reject</button>
          <button onClick={() => post('unmap')} className="underline">Remove</button>
        </div>
      )}
      {msg && <p className="text-xs text-slate-700" role="status">{msg}</p>}
    </li>
  )
}

export default function DrillVideosAdmin({ course }: { course: string }) {
  const [drills, setDrills] = useState<LessonDrill[]>([])
  const [maps, setMaps] = useState<Mapping[]>([])
  const [ready, setReady] = useState(true)
  const [pastedReady, setPastedReady] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await fetch(`${api}?course=${course}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j.error || 'Could not load.'); return }
    setError(null); setDrills(j.drills || []); setMaps(j.mappings || []); setReady(j.migrationApplied !== false); setPastedReady(j.pastedReady !== false)
  }, [course])
  useEffect(() => { void load() }, [load])

  return (
    <section className="space-y-3" data-testid="drill-videos-admin">
      <h2 className="text-xl font-bold">Drill videos</h2>
      <p className="text-sm text-slate-600">Pick the library drill whose video demonstrates each lesson drill, watch it, then approve it. Learners see only approved videos. Nothing here is approved until you do it.</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {ready && !pastedReady && <p className="text-sm text-amber-800">Pasting a YouTube link is not set up on this database yet (migration 084). Library videos still work.</p>}
      {!ready && <p className="text-sm text-amber-800">Drill videos are not set up on this database yet (migration 083).</p>}
      {Array.from(new Set(drills.map(d => d.lesson_key))).map(k => {
        const group = drills.filter(d => d.lesson_key === k)
        return (
          <div key={k}>
            <h3 className="mb-1 font-semibold text-slate-800">{group[0].number_label} {group[0].lesson_title}</h3>
            <ul className="space-y-2">{group.map(d => <Row key={d.label + k} course={course} d={d} m={maps.find(x => x.lesson_key === d.lesson_key && x.drill_label === d.label)} reload={load} />)}</ul>
          </div>
        )
      })}
    </section>
  )
}
