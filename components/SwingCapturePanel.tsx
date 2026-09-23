'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Ruler,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { confidenceLabel, SwingCapture } from '@/lib/swingCapture'

interface CaptureWithUrl extends SwingCapture {
  video_url?: string | null
}

interface Props {
  playerId: string
  playerName: string
  teamId: string
  onMetricsChanged?: () => void | Promise<void>
}

const MAX_BETA_BYTES = 45 * 1024 * 1024
const VIDEO_BUCKET = 'journal-media'

async function readVideoMetadata(file: File): Promise<{
  durationMs: number | null
  frameWidth: number | null
  frameHeight: number | null
}> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = () => {
      URL.revokeObjectURL(url)
      resolve({
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
        frameWidth: video.videoWidth || null,
        frameHeight: video.videoHeight || null,
      })
    }
    video.preload = 'metadata'
    video.onloadedmetadata = done
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ durationMs: null, frameWidth: null, frameHeight: null })
    }
    video.src = url
  })
}

function statusCopy(status: SwingCapture['status']): string {
  switch (status) {
    case 'uploaded': return 'Ready to analyze'
    case 'queued': return 'Queued'
    case 'processing': return 'Analyzing video…'
    case 'review': return 'Review the estimate'
    case 'confirmed': return 'Confirmed measurement'
    case 'failed': return 'Analysis needs another try'
  }
}

function metric(value: number | null, suffix: string, digits = 1) {
  return value == null ? '—' : `${Number(value).toFixed(digits)}${suffix}`
}

export function SwingCapturePanel({ playerId, playerName, teamId, onMetricsChanged }: Props) {
  const supabase = createSupabaseComponentClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [captures, setCaptures] = useState<CaptureWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captureFps, setCaptureFps] = useState('240')
  const [cameraDistanceFt, setCameraDistanceFt] = useState('10')
  const [showGuide, setShowGuide] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editExit, setEditExit] = useState('')
  const [editAngle, setEditAngle] = useState('')
  const [editDistance, setEditDistance] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/swing-captures?teamId=${encodeURIComponent(teamId)}&playerId=${encodeURIComponent(playerId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load swing captures.')
      setCaptures(data.captures || [])
    } catch (e: any) {
      setError(e.message || 'Could not load swing captures.')
    } finally {
      setLoading(false)
    }
  }, [teamId, playerId])

  useEffect(() => { load() }, [load])

  const beginEdit = (capture: CaptureWithUrl) => {
    setEditingId(capture.id)
    setEditExit(capture.exit_velocity_mph == null ? '' : String(capture.exit_velocity_mph))
    setEditAngle(capture.launch_angle_deg == null ? '' : String(capture.launch_angle_deg))
    setEditDistance(capture.projected_distance_ft == null ? '' : String(capture.projected_distance_ft))
  }

  const uploadVideo = async (file: File) => {
    setError(null)
    if (!file.type.startsWith('video/')) {
      setError('Choose a video from your camera roll.')
      return
    }
    if (file.size > MAX_BETA_BYTES) {
      setError('For this private beta, trim the swing to a short 2–3 second clip (45 MB max). High-speed production uploads will use resumable transfer.')
      return
    }

    const fps = Number(captureFps)
    if (!Number.isFinite(fps) || fps < 24 || fps > 1000) {
      setError('Choose the frame rate the phone used to record the clip.')
      return
    }

    const cameraDistance = Number(cameraDistanceFt)
    if (!Number.isFinite(cameraDistance) || cameraDistance < 3 || cameraDistance > 30) {
      setError('Measure from the phone lens to the ball at contact (3–30 ft). This is required to turn pixels into real-world speed.')
      return
    }

    setUploading(true)
    try {
      const metadata = await readVideoMetadata(file)

      // Authorization and object-path creation happen server-side. The browser
      // gets a token for one specific private object instead of broad bucket
      // INSERT permission.
      const authRes = await fetch('/api/swing-captures/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          playerId,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      const uploadAuth = await authRes.json()
      if (!authRes.ok || !uploadAuth.path || !uploadAuth.token) {
        throw new Error(uploadAuth.error || 'Could not authorize swing video upload.')
      }

      const bucket = uploadAuth.bucket || VIDEO_BUCKET
      const path = uploadAuth.path as string
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, uploadAuth.token, file, {
          contentType: file.type || 'video/mp4',
          cacheControl: '3600',
        })
      if (uploadError) throw uploadError

      const res = await fetch('/api/swing-captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          playerId,
          storageBucket: bucket,
          storagePath: path,
          originalFilename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          source: 'video_upload',
          captureFps: fps,
          cameraDistanceFt: cameraDistance,
          frameWidth: metadata.frameWidth,
          frameHeight: metadata.frameHeight,
          durationMs: metadata.durationMs,
          recordedAt: new Date().toISOString(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Video uploaded, but BenchCoach could not register the swing. Please retry with a new clip.')
      }

      if (inputRef.current) inputRef.current.value = ''
      await load()
    } catch (e: any) {
      setError(e.message || 'Could not upload that swing.')
    } finally {
      setUploading(false)
    }
  }

  const analyze = async (capture: CaptureWithUrl) => {
    setBusyId(capture.id)
    setError(null)
    try {
      const res = await fetch('/api/swing-captures/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, captureId: capture.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === 'SWING_ANALYZER_NOT_CONFIGURED') {
          throw new Error('The capture workflow is live, but the computer-vision analyzer is not connected in this environment yet. You can enter calibration results manually below.')
        }
        throw new Error(data.error || 'Could not analyze that swing.')
      }
      await load()
    } catch (e: any) {
      setError(e.message || 'Could not analyze that swing.')
    } finally {
      setBusyId(null)
    }
  }

  const review = async (capture: CaptureWithUrl) => {
    setBusyId(capture.id)
    setError(null)
    try {
      const res = await fetch('/api/swing-captures', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          captureId: capture.id,
          action: 'review',
          exitVelocityMph: editExit === '' ? null : Number(editExit),
          launchAngleDeg: editAngle === '' ? null : Number(editAngle),
          projectedDistanceFt: editDistance === '' ? null : Number(editDistance),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the review.')
      setEditingId(null)
      await load()
    } catch (e: any) {
      setError(e.message || 'Could not save the review.')
    } finally {
      setBusyId(null)
    }
  }

  const confirm = async (capture: CaptureWithUrl) => {
    setBusyId(capture.id)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        teamId,
        captureId: capture.id,
        action: 'confirm',
      }
      if (editingId === capture.id) {
        payload.exitVelocityMph = editExit === '' ? null : Number(editExit)
        payload.launchAngleDeg = editAngle === '' ? null : Number(editAngle)
        payload.projectedDistanceFt = editDistance === '' ? null : Number(editDistance)
      }

      const res = await fetch('/api/swing-captures', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not confirm that swing.')
      setEditingId(null)
      await load()
      await onMetricsChanged?.()
    } catch (e: any) {
      setError(e.message || 'Could not confirm that swing.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 mb-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Camera size={19} className="text-blue-700" />
            <h3 className="font-semibold text-gray-900">Phone Swing Capture</h3>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Beta</span>
          </div>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Record one swing in slow motion, estimate exit velocity and projected distance, then confirm it before it enters {playerName}&apos;s measurements.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowGuide(v => !v)}
          className="text-sm text-blue-700 hover:text-blue-900 whitespace-nowrap"
        >
          {showGuide ? 'Hide setup' : 'How to record'}
        </button>
      </div>

      {showGuide && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-white p-4 text-sm text-gray-700">
          <div className="font-medium text-gray-900 mb-2">For the cleanest reading</div>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Use the phone&apos;s Slow-Mo camera mode — 240 fps when available, otherwise 120 fps.</li>
            <li>Put the phone on a tripod side-on to the hitter, with the lens roughly perpendicular to the ball at contact.</li>
            <li>Measure from the phone lens to the ball at contact and enter that distance below. Use the same setup for a session.</li>
            <li>Keep contact and the first part of ball flight in frame. Bright light and a plain background help the tracker.</li>
            <li>Trim the clip to roughly 2–3 seconds around contact before uploading.</li>
          </ol>
          <p className="text-xs text-gray-500 mt-3">
            Projected distance is an estimate from the measured launch. It is not the same as a tape-measured landing distance.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[140px_180px_1fr] items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Frame rate</label>
          <select
            value={captureFps}
            onChange={e => setCaptureFps(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="240">240 fps</option>
            <option value="120">120 fps</option>
            <option value="60">60 fps</option>
            <option value="30">30 fps</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone → ball distance</label>
          <div className="relative">
            <input
              type="number"
              min="3"
              max="30"
              step="0.1"
              inputMode="decimal"
              value={cameraDistanceFt}
              onChange={e => setCameraDistanceFt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-8 text-sm"
            />
            <span className="absolute right-3 top-2 text-sm text-gray-400">ft</span>
          </div>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) uploadVideo(file)
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? 'Uploading…' : 'Upload slow-motion swing'}
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Private beta: short clips up to 45 MB. The production mobile uploader will use resumable transfer for larger high-speed video.
      </p>

      {error && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button>
        </div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Loading swings…
        </div>
      ) : captures.length > 0 ? (
        <div className="mt-5 space-y-4">
          {captures.map(capture => {
            const busy = busyId === capture.id
            const editing = editingId === capture.id
            const canConfirm = capture.status === 'review' || editing
            return (
              <div key={capture.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="lg:w-56 shrink-0">
                    {capture.video_url ? (
                      <video
                        src={capture.video_url}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full aspect-video rounded-lg bg-black object-contain"
                      />
                    ) : (
                      <div className="w-full aspect-video rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
                        <Video size={26} />
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-500">
                      {new Date(capture.recorded_at).toLocaleString()}
                      {capture.capture_fps ? ` • ${capture.capture_fps} fps` : ''}
                      {capture.camera_distance_ft ? ` • ${capture.camera_distance_ft} ft setup` : ''}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{statusCopy(capture.status)}</div>
                        {capture.confidence != null && (
                          <div className="text-xs text-gray-500 mt-0.5">{confidenceLabel(Number(capture.confidence))} • {Math.round(Number(capture.confidence) * 100)}%</div>
                        )}
                      </div>
                      {capture.status === 'confirmed' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                          <CheckCircle2 size={13} /> In Measurements
                        </span>
                      )}
                    </div>

                    {editing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                        <label className="text-xs font-medium text-gray-700">
                          Exit velocity (mph)
                          <input
                            type="number" inputMode="decimal" step="0.1" value={editExit}
                            onChange={e => setEditExit(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            placeholder="52.4"
                          />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                          Launch angle (°)
                          <input
                            type="number" inputMode="decimal" step="0.1" value={editAngle}
                            onChange={e => setEditAngle(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            placeholder="18.0"
                          />
                        </label>
                        <label className="text-xs font-medium text-gray-700">
                          Projected distance (ft)
                          <input
                            type="number" inputMode="decimal" step="0.1" value={editDistance}
                            onChange={e => setEditDistance(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            placeholder="178"
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 mt-4">
                        <div className="rounded-lg bg-gray-50 p-3">
                          <div className="flex items-center gap-1 text-[11px] text-gray-500"><Gauge size={12} /> Exit velo</div>
                          <div className="mt-1 text-lg font-semibold text-gray-900">{metric(capture.exit_velocity_mph, ' mph')}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3">
                          <div className="flex items-center gap-1 text-[11px] text-gray-500"><Play size={12} /> Launch</div>
                          <div className="mt-1 text-lg font-semibold text-gray-900">{metric(capture.launch_angle_deg, '°')}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3">
                          <div className="flex items-center gap-1 text-[11px] text-gray-500"><Ruler size={12} /> Projected</div>
                          <div className="mt-1 text-lg font-semibold text-gray-900">{metric(capture.projected_distance_ft, ' ft', 0)}</div>
                        </div>
                      </div>
                    )}

                    {capture.analysis_error && (
                      <div className="mt-3 text-xs text-red-600">{capture.analysis_error}</div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {(capture.status === 'uploaded' || capture.status === 'failed') && (
                        <button
                          disabled={busy}
                          onClick={() => analyze(capture)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-black disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Analyze swing
                        </button>
                      )}

                      {capture.status === 'processing' && (
                        <button disabled className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">
                          <Loader2 size={14} className="animate-spin" /> Analyzing…
                        </button>
                      )}

                      {capture.status !== 'confirmed' && !editing && (
                        <button
                          onClick={() => beginEdit(capture)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {capture.status === 'review' ? 'Edit estimate' : 'Enter calibration results'}
                        </button>
                      )}

                      {editing && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => review(capture)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {busy && <Loader2 size={14} className="animate-spin" />} Save review
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </>
                      )}

                      {canConfirm && (
                        <button
                          disabled={busy}
                          onClick={() => confirm(capture)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          Confirm & add to Measurements
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-gray-300 bg-white/60 px-4 py-5 text-center">
          <Camera size={24} className="mx-auto text-gray-400" />
          <p className="mt-2 text-sm text-gray-700">No phone-recorded swings for {playerName} yet.</p>
          <p className="mt-1 text-xs text-gray-500">Start with one clean, short slow-motion clip.</p>
        </div>
      )}

      {captures.length > 0 && !loading && (
        <button onClick={load} className="mt-4 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
          <RefreshCw size={12} /> Refresh captures
        </button>
      )}
    </div>
  )
}
