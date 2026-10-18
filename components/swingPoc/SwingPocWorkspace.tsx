'use client'

// Swing mechanics POC — the coach's review workspace.
//
// Order of work, as a coach does it: record or upload → mark contact → analyse
// → watch the skeleton on the video → read each observation with its evidence
// → accept, edit, reject or mark not assessable → see library drills for what
// they accepted. Nothing on this page writes a measurement or a plan.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2, Upload, Camera, Target, AlertTriangle, Play, Check, X, Pencil, Ban } from 'lucide-react'
import { frameAt, contentRect, seekTimeForFrame, type ResultFrame } from '@/lib/swingPoc/rules'

const Pose3DViewer = dynamic(() => import('./Pose3DViewer'), { ssr: false, loading: () => <div className="h-72 bg-slate-900 rounded-lg" /> })

const EDGES: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 11], [0, 12],
]
const VIS = 0.5

interface Detail {
  capture: any
  job: { state: string; error?: { code: string; message: string } | null; updated_at?: string }
  result: any | null
  review: any | null
  videoUrl: string
}

const STATE_LABEL: Record<string, string> = {
  not_analyzed: 'Not analysed yet', queued: 'Queued', processing: 'Analysing…', done: 'Analysed', failed: 'Analysis failed',
}

export default function SwingPocWorkspace({ playerId }: { playerId: string }) {
  const teamId = useSearchParams().get('teamId')
  const [captures, setCaptures] = useState<any[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ handedness: 'R', view: 'face_on', setting: 'tee' })

  const loadList = useCallback(async () => {
    if (!teamId) return
    const r = await fetch(`/api/swing-poc/captures?teamId=${teamId}&playerId=${playerId}`)
    const d = await r.json()
    if (r.ok) setCaptures(d.captures || [])
    else setError(d.error || 'Could not load captures.')
  }, [teamId, playerId])

  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/swing-poc/captures/${id}`)
    const d = await r.json()
    if (r.ok) setDetail(d)
    else setError(d.error || 'Could not load the capture.')
  }, [])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { if (selected) void loadDetail(selected) }, [selected, loadDetail])

  // Poll while the worker has the job. The request that queued it returned
  // at once; this is how the result arrives.
  const jobState = detail?.job?.state
  useEffect(() => {
    if (!selected || (jobState !== 'queued' && jobState !== 'processing')) return
    const t = setInterval(() => { void loadDetail(selected) }, 2000)
    return () => clearInterval(t)
  }, [selected, jobState, loadDetail])

  const upload = async (file: File | undefined) => {
    if (!file || !teamId) return
    setError(null)
    setBusy('upload')
    try {
      const qs = new URLSearchParams({ teamId, playerId, handedness: form.handedness, view: form.view, setting: form.setting })
      const r = await fetch(`/api/swing-poc/captures?${qs}`, {
        method: 'POST', body: file,
        headers: { 'Content-Type': file.type || 'video/mp4', 'X-File-Name': encodeURIComponent(file.name).slice(0, 120) },
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Upload failed (${r.status}).`)
      await loadList()
      setSelected(d.capture.id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (!teamId) return <p className="p-6 text-sm text-gray-600">Open this page from a player on a team (it needs ?teamId=).</p>

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Internal proof of concept.</strong> Pose estimates from one phone camera. Nothing here is validated, rated,
        or saved to the player&apos;s record — every finding needs your review.
      </div>

      <section className="bg-white rounded-lg border p-4 space-y-3">
        <h1 className="text-lg font-semibold">Swing mechanics (POC)</h1>
        <details className="text-sm text-gray-700">
          <summary className="cursor-pointer font-medium">How to record</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Camera level with the hips, side-on to the hitter (facing their chest or back), 10–15 feet away, not moving.</li>
            <li>Whole body in frame from head to feet, from the stance through the follow-through.</li>
            <li>Start recording a second before the swing. Good light. One hitter in the picture.</li>
            <li>Slow-motion helps if your phone offers it. A browser can&apos;t always record high frame rates — recording in the camera app and uploading is more reliable.</li>
          </ul>
        </details>
        <div className="flex flex-wrap gap-3 items-end text-sm">
          <label className="flex flex-col">Hitter bats
            <select className="border rounded px-2 py-1" value={form.handedness} onChange={e => setForm({ ...form, handedness: e.target.value })}>
              <option value="R">Right</option><option value="L">Left</option>
            </select>
          </label>
          <label className="flex flex-col">Camera view
            <select className="border rounded px-2 py-1" value={form.view} onChange={e => setForm({ ...form, view: e.target.value })}>
              <option value="face_on">Side-on (facing chest or back)</option>
              <option value="down_the_line">Behind / in front of the hitter</option>
              <option value="other">Other angle</option>
            </select>
          </label>
          <label className="flex flex-col">Setting
            <select className="border rounded px-2 py-1" value={form.setting} onChange={e => setForm({ ...form, setting: e.target.value })}>
              <option value="tee">Tee</option><option value="front_toss">Front toss</option><option value="live">Live pitching</option><option value="other">Other</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded cursor-pointer">
            <Upload size={16} /> Upload video
            <input type="file" accept="video/*" className="hidden" data-testid="upload-input" onChange={e => upload(e.target.files?.[0])} />
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-2 border rounded cursor-pointer">
            <Camera size={16} /> Record
            <input type="file" accept="video/*" capture="environment" className="hidden" onChange={e => upload(e.target.files?.[0])} />
          </label>
          {busy === 'upload' && <span className="inline-flex items-center gap-1 text-gray-600"><Loader2 className="animate-spin" size={14} /> Uploading…</span>}
        </div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        {captures.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {captures.map(c => (
              <li key={c.id}>
                <button onClick={() => setSelected(c.id)}
                  className={`px-3 py-1 rounded border ${selected === c.id ? 'bg-blue-50 border-blue-400' : ''}`}>
                  {new Date(c.created_at).toLocaleString()} · {STATE_LABEL[c.job] || c.job}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && <CaptureReview key={detail.capture.id} detail={detail} reload={() => loadDetail(detail.capture.id)} setError={setError} />}
    </div>
  )
}

function CaptureReview({ detail, reload, setError }: { detail: Detail; reload: () => Promise<void>; setError: (s: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tMs, setTMs] = useState(0)
  const [showOverlay, setShowOverlay] = useState(true)
  const [drills, setDrills] = useState<any | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const { capture, job, result, review } = detail
  const times: number[] = capture.probe?.frame_times_ms || []
  const frames: ResultFrame[] = result?.status === 'ok' ? result.frames : []
  const contact = capture.contact_history?.at(-1) || null

  // Current frame index from the file's own timestamps.
  const k = useMemo(() => {
    if (!times.length) return -1
    let best = 0
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - tMs) < Math.abs(times[best] - tMs)) best = i
    return best
  }, [times, tMs])

  // Follow the PRESENTED frame. requestVideoFrameCallback reports the media
  // time of the frame actually on screen; currentTime alone can lead it.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let handle = 0
    const anyV = v as any
    if (typeof anyV.requestVideoFrameCallback === 'function') {
      const cb = (_now: number, meta: any) => { setTMs(meta.mediaTime * 1000); handle = anyV.requestVideoFrameCallback(cb) }
      handle = anyV.requestVideoFrameCallback(cb)
      const onSeek = () => setTMs(v.currentTime * 1000)
      v.addEventListener('seeked', onSeek)
      return () => { anyV.cancelVideoFrameCallback?.(handle); v.removeEventListener('seeked', onSeek) }
    }
    const onTime = () => setTMs(v.currentTime * 1000)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('seeked', onTime)
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('seeked', onTime) }
  }, [detail.videoUrl])

  const holdMs: number | undefined = result?.source?.frame_intervals?.max_ms ?? undefined
  const current = useMemo(() => frameAt(frames, tMs, holdMs), [frames, tMs, holdMs])

  // Draw the 2D skeleton for the frame on screen, on the picture area only.
  useEffect(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    const rect = v.getBoundingClientRect()
    c.width = Math.round(rect.width)
    c.height = Math.round(rect.height)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!showOverlay || !current?.lm) return
    const r = contentRect(c.width, c.height, v.videoWidth, v.videoHeight)
    const pt = (j: number) => {
      const [x, y, , vis, pres] = current.lm![j]
      return vis >= VIS && pres >= VIS ? [r.x + x * r.w, r.y + y * r.h] : null
    }
    ctx.lineWidth = 2
    ctx.strokeStyle = '#34d399'
    for (const [a, b] of EDGES) {
      const pa = pt(a), pb = pt(b)
      if (pa && pb) { ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke() }
    }
    ctx.fillStyle = '#f87171'
    for (let j = 0; j < 33; j++) { const p = pt(j); if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill() } }
  }, [current, showOverlay])

  const seekMs = (ms: number) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    const idx = times.length ? times.reduce((b, t, i) => (Math.abs(t - ms) < Math.abs(times[b] - ms) ? i : b), 0) : -1
    v.currentTime = idx >= 0 ? seekTimeForFrame(times, idx) : ms / 1000
  }
  const step = (d: number) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    if (times.length) {
      const next = Math.max(0, Math.min(times.length - 1, k + d))
      v.currentTime = seekTimeForFrame(times, next)
    } else {
      v.currentTime = Math.max(0, v.currentTime + d / 240)
    }
  }

  const patch = async (body: any) => {
    setError(null)
    const r = await fetch(`/api/swing-poc/captures/${capture.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setError(d.error || 'Could not save.')
    await reload()
  }
  const markContact = () => patch({ contact_ms: times.length ? times[k] : tMs, frame: times.length ? k : null })
  const analyze = async () => {
    setError(null)
    const r = await fetch(`/api/swing-poc/captures/${capture.id}/analyze`, { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setError(d.error || 'Could not start the analysis.')
    await reload()
  }
  const decide = async (findingId: string, state: string, noteText?: string) => {
    setError(null)
    const r = await fetch(`/api/swing-poc/captures/${capture.id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findingId, state, note: noteText }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setError(d.error || 'Could not save the review.')
    setNoteFor(null)
    setDrills(null)
    await reload()
  }
  const findDrills = async () => {
    const r = await fetch(`/api/swing-poc/captures/${capture.id}/drills`, { method: 'POST' })
    setDrills(await r.json().catch(() => ({ error: 'Could not load drills.' })))
  }

  const reviewFor = (id: string) => (review && result && review.input_hash === result.input_hash ? review.findings?.[id] : null)
  const tags = capture.event_tags || {}
  // The analysis is current only if it used the latest contact AND foot-strike marks.
  const fsMark = tags.foot_strike?.t_ms ?? null
  const contactIsAnalyzed = result?.request?.contact_ms != null && contact && Math.abs(result.request.contact_ms - contact.t_ms) < 0.01
    && (result.request.foot_strike_ms ?? null) === fsMark
  const events = result?.events || {}

  return (
    <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
      <section className="bg-white rounded-lg border p-3 space-y-3 min-w-0">
        <div className="relative bg-black rounded overflow-hidden">
          <video ref={videoRef} src={detail.videoUrl} controls playsInline muted preload="auto" className="w-full max-h-[70vh] block" data-testid="swing-video" />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" data-testid="overlay" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button onClick={() => step(-1)} className="p-2 border rounded" aria-label="Previous frame"><ChevronLeft size={16} /></button>
          <button onClick={() => step(1)} className="p-2 border rounded" aria-label="Next frame"><ChevronRight size={16} /></button>
          <span className="tabular-nums text-gray-700" data-testid="frame-readout">
            {times.length ? `frame ${k + 1} / ${times.length}` : 'frame times unavailable'} · {(tMs / 1000).toFixed(3)} s
            {current ? ` · pose @ ${current.t_ms.toFixed(1)} ms` : frames.length ? ' · no analysed frame here' : ''}
          </span>
          <button onClick={markContact} className="ml-auto inline-flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded" data-testid="mark-contact">
            <Target size={15} /> Mark contact at this frame
          </button>
        </div>
        {times.length > 0 && (
          <input type="range" min={0} max={times.length - 1} value={Math.max(0, k)} aria-label="Frame"
            onChange={e => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = seekTimeForFrame(times, Number(e.target.value)) } }}
            className="w-full" />
        )}
        <div className="text-sm text-gray-700 space-y-1">
          <p>
            Contact: {contact ? <button className="underline" onClick={() => seekMs(contact.t_ms)}>{(contact.t_ms / 1000).toFixed(3)} s{contact.frame != null ? ` (frame ${contact.frame + 1})` : ''}</button> : 'not marked'}
            {contact && <span className="text-gray-500"> · marked by you{capture.contact_history.length > 1 ? `, ${capture.contact_history.length - 1} earlier mark(s) kept` : ''}</span>}
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={analyze} disabled={!contact || jobBusy(job.state)} className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50" data-testid="analyze">
              {contactIsAnalyzed && job.state === 'done' ? 'Re-analyse' : 'Analyse swing'}
            </button>
            <span data-testid="job-state" className="inline-flex items-center gap-1">
              {jobBusy(job.state) && <Loader2 className="animate-spin" size={14} />}{STATE_LABEL[job.state] || job.state}
            </span>
            {result?.status === 'ok' && !contactIsAnalyzed && <span className="text-amber-700">Your contact or foot-strike mark changed since this analysis — re-analyse.</span>}
            <label className="inline-flex items-center gap-1 ml-auto"><input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} /> Skeleton</label>
          </div>
          {job.state === 'failed' && job.error && (
            <p className="text-red-700 flex items-start gap-1" role="alert"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{job.error.message} <button className="underline ml-1" onClick={analyze}>Retry</button></p>
          )}
        </div>

        {result?.status === 'ok' && (
          <div className="text-sm space-y-2">
            <h3 className="font-semibold">Events</h3>
            <ul className="space-y-1">
              <EventRow label="Contact" ev={events.contact} note="marked by you" onSeek={seekMs} />
              <EventRow label="Foot strike" ev={tags.foot_strike ? { t_ms: tags.foot_strike.t_ms } : events.foot_strike}
                note={tags.foot_strike ? (events.foot_strike?.source === 'coach' ? 'your mark (used in this analysis)' : 'your mark — re-analyse to use it') : events.foot_strike?.status === 'estimated' ? 'automatic estimate — check it, and move it if wrong' : events.foot_strike?.reason}
                onSeek={seekMs} onTag={() => patch({ event_tag: { name: 'foot_strike', t_ms: times.length ? times[k] : tMs } })} />
              <EventRow label="Load" ev={tags.load} note={tags.load ? 'your tag' : 'not estimated — tag it if useful'} onSeek={seekMs}
                onTag={() => patch({ event_tag: { name: 'load', t_ms: times.length ? times[k] : tMs } })} />
              <EventRow label="Swing start" ev={tags.swing_start} note={tags.swing_start ? 'your tag' : 'not estimated — tag it if useful'} onSeek={seekMs}
                onTag={() => patch({ event_tag: { name: 'swing_start', t_ms: times.length ? times[k] : tMs } })} />
            </ul>
            <p className="text-xs text-gray-500">Your marks are kept with the capture. The stride and forward-move numbers depend on foot strike: if the automatic estimate is wrong, set it here and re-analyse. Load and swing start are tags for your reference; nothing is computed from them yet.</p>
          </div>
        )}

        {result?.status === 'ok' && (
          <div>
            <h3 className="font-semibold text-sm mb-1">Estimated 3D pose</h3>
            <Pose3DViewer world={current?.world || null} />
          </div>
        )}
      </section>

      <section className="space-y-3 min-w-0">
        {result?.status === 'ok' ? (
          <>
            <div className="bg-white rounded-lg border p-3 text-xs text-gray-600 space-y-1" data-testid="provenance">
              <p><strong>Source:</strong> {result.source.width}×{result.source.height}{result.source.rotation_deg ? ` (rotated ${result.source.rotation_deg}°)` : ''}, {result.source.frame_count} frames, {result.source.frame_intervals.effective_fps} fps{result.source.frame_intervals.variable_frame_rate ? ' (variable)' : ''}</p>
              <p><strong>Analysed:</strong> {result.quality.analysed_frames} frames ({result.sampling.rule}); pose found in {result.quality.pose_detected_frames}</p>
              <p><strong>Model:</strong> {result.model.version} · analyzer {result.analyzer.version} · {result.timing.total_ms} ms</p>
              {result.quality.warnings.map((w: string) => <p key={w} className="text-amber-700">⚠ {w}</p>)}
            </div>
            {result.observations.map((o: any) => {
              const rv = reviewFor(o.id)
              return (
                <article key={o.id} className="bg-white rounded-lg border p-3 text-sm space-y-2" data-testid={`obs-${o.id}`}>
                  <header className="flex items-start gap-2">
                    <h3 className="font-semibold flex-1">{o.label}</h3>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-700" data-testid="validation-badge">{o.validation_status === 'experimental_feasibility' ? 'feasibility check' : 'unvalidated'}</span>
                  </header>
                  {o.status === 'observed' ? (
                    <>
                      <ul className="space-y-1">
                        {o.values.map((v: any) => (
                          <li key={v.name}><span className="font-medium tabular-nums">{v.value}</span> <span className="text-gray-500">{v.unit}</span><br /><span className="text-gray-700">{v.label}</span></li>
                        ))}
                      </ul>
                      <p className="text-xs text-gray-600">Input quality: {o.data_quality} (how clearly the joints were seen — not how good the swing is)</p>
                      <div className="flex flex-wrap gap-1">
                        {o.evidence_frames.map((e: any) => (
                          <button key={`${e.label}-${e.frame}`} onClick={() => seekMs(e.t_ms)} className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded">
                            <Play size={11} />{e.label} · {(e.t_ms / 1000).toFixed(3)}s
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-700"><strong>Not assessable.</strong> {o.reason}</p>
                  )}
                  {o.feasibility?.proxy_sd_while_still_deg != null && (
                    <p className="text-xs text-gray-500">Model diagnostic: the estimated-3D proxy scattered {o.feasibility.proxy_sd_while_still_deg}° while the hitter was still. Not a measurement of the player.</p>
                  )}
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer">Definition, method and limits</summary>
                    <p className="mt-1">{o.definition}</p>
                    <p className="mt-1"><strong>Method:</strong> {o.method}</p>
                    <ul className="list-disc pl-4 mt-1">{o.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul>
                  </details>
                  <div className="flex flex-wrap gap-1 pt-1 border-t">
                    <span className="text-xs text-gray-600 mr-1 self-center">Your review: <strong data-testid={`review-${o.id}`}>{rv?.state || 'pending'}</strong>{rv?.note ? ` — “${rv.note}”` : ''}</span>
                    {o.status === 'observed' && <button onClick={() => decide(o.id, 'accepted')} className="text-xs px-2 py-1 border rounded inline-flex items-center gap-1" data-testid={`accept-${o.id}`}><Check size={12} />Accept</button>}
                    {o.status === 'observed' && <button onClick={() => { setNoteFor(o.id); setNote(rv?.note || '') }} className="text-xs px-2 py-1 border rounded inline-flex items-center gap-1"><Pencil size={12} />Edit</button>}
                    <button onClick={() => decide(o.id, 'rejected')} className="text-xs px-2 py-1 border rounded inline-flex items-center gap-1"><X size={12} />Reject</button>
                    <button onClick={() => decide(o.id, 'not_assessable')} className="text-xs px-2 py-1 border rounded inline-flex items-center gap-1"><Ban size={12} />Not assessable</button>
                  </div>
                  {noteFor === o.id && (
                    <div className="flex gap-2">
                      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Your wording of this finding" className="flex-1 border rounded px-2 py-1 text-sm" />
                      <button onClick={() => decide(o.id, 'edited', note)} className="text-xs px-2 py-1 bg-blue-600 text-white rounded">Save</button>
                    </div>
                  )}
                </article>
              )
            })}
            <div className="bg-white rounded-lg border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold flex-1">Drills for findings you accepted</h3>
                <button onClick={findDrills} className="text-xs px-2 py-1 border rounded" data-testid="find-drills">Find drills</button>
              </div>
              {drills?.message && <p className="text-gray-600">{drills.message}</p>}
              {drills?.error && <p className="text-red-700">{drills.error}</p>}
              {drills?.drills?.length > 0 && (
                <ul className="space-y-2" data-testid="drill-list">
                  {drills.drills.map((d: any) => (
                    <li key={d.id}>
                      <span className="font-medium">{d.drill_name}</span>
                      {d.video_url ? <> · <a href={d.video_url} target="_blank" rel="noreferrer" className="underline text-blue-700">video</a></> : <span className="text-gray-500"> · no video in the library</span>}
                      {d.description && <p className="text-xs text-gray-600">{d.description}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {drills?.proposal && (
                <div className="rounded border border-dashed p-2 text-xs text-gray-700" data-testid="plan-proposal">
                  <p className="font-medium">Add to plan — proposal only</p>
                  <p>Would set a priority on: {drills.proposal.focus.join('; ')} · {drills.proposal.drill_ids.length} drill(s).</p>
                  <p className="text-gray-500">{drills.proposal.note}</p>
                </div>
              )}
            </div>
          </>
        ) : result?.status === 'failed' ? (
          <p className="bg-white rounded-lg border p-3 text-sm text-red-700">{result.error?.message}</p>
        ) : (
          <p className="bg-white rounded-lg border p-3 text-sm text-gray-600">Step through to the frame where the bat meets the ball, mark contact, then analyse.</p>
        )}
      </section>
    </div>
  )
}

function jobBusy(s: string) {
  return s === 'queued' || s === 'processing'
}

function EventRow({ label, ev, note, onSeek, onTag }: { label: string; ev: any; note?: string; onSeek: (ms: number) => void; onTag?: () => void }) {
  const t = ev?.t_ms
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-24 font-medium">{label}</span>
      {t != null ? <button className="underline tabular-nums" onClick={() => onSeek(t)}>{(t / 1000).toFixed(3)} s</button> : <span className="text-gray-500">—</span>}
      {note && <span className="text-xs text-gray-500">{note}</span>}
      {onTag && <button onClick={onTag} className="text-xs px-2 py-0.5 border rounded ml-auto">Set to this frame</button>}
    </li>
  )
}
