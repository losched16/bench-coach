import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { deleteCapture, readJob, readResult, readReview, signVideo, writeMeta, StoreError, readPrepare, readPlayback, playbackFile, parseCaptureFps } from '@/lib/swingPoc/store'
import { authorizeCapture, notEnabled, errorResponse } from '@/lib/swingPoc/access'

// Swing mechanics POC (internal, SWING_MECHANICS_POC=1). See docs/swing-mechanics-poc/.
export const dynamic = 'force-dynamic'

// GET — the capture, its job state, the analysis (when done), the coach's
// review, and a short-lived signed URL for the video.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const { meta, userId } = await authorizeCapture(params.id, 'read')
    const [job, result, review, prepare, playback] = await Promise.all([
      readJob(meta.id), readResult(meta.id), readReview(meta.id), readPrepare(meta.id), readPlayback(meta.id),
    ])
    const token = encodeURIComponent(signVideo(meta.id, userId))
    const base = `/api/swing-poc/captures/${meta.id}/video?token=${token}`
    const useCopy = !!playbackFile(meta, playback)
    return NextResponse.json({
      capture: meta,
      job: job ?? { state: 'not_analyzed' },
      result,
      review,
      prepare: prepare ?? { state: 'not_requested' },
      // Frame times the scrubber steps through, and the alignment proof for
      // the copy being played.
      playback: playback ? { frame_times_ms: playback.frame_times_ms, proxy: playback.proxy, source: playback.source } : null,
      videoUrl: useCopy ? `${base}&variant=playback` : base,
      playingCopy: useCopy,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

// PATCH — the coach's annotations: contact mark, event tags, handedness, view.
// Contact marks are appended, never overwritten, so the history is provenance.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const { meta, userId } = await authorizeCapture(params.id, 'record')
    const body = await request.json().catch(() => ({}))
    const now = new Date().toISOString()
    const times: number[] = (await readPlayback(meta.id))?.frame_times_ms || (meta as any).probe?.frame_times_ms || []
    const lastT = times.length ? times[times.length - 1] : Infinity

    if (body.contact_ms !== undefined) {
      const t = Number(body.contact_ms)
      if (!Number.isFinite(t) || t < 0 || t > lastT + 50) throw new StoreError('The contact mark is outside the video.', 400)
      const frame = Number.isInteger(body.frame) && body.frame >= 0 && body.frame < times.length ? body.frame : null
      meta.contact_history.push({ t_ms: Math.round(t * 1000) / 1000, frame, set_by: userId, set_at: now })
    }
    if (body.event_tag) {
      const name = String(body.event_tag.name || '')
      if (!['load', 'swing_start', 'foot_strike'].includes(name)) throw new StoreError('Unknown event.', 400)
      const t = body.event_tag.t_ms
      if (t === null) meta.event_tags[name] = null
      else {
        const v = Number(t)
        if (!Number.isFinite(v) || v < 0 || v > lastT + 50) throw new StoreError('That event is outside the video.', 400)
        meta.event_tags[name] = { t_ms: v, set_by: userId, set_at: now }
      }
    }
    if (body.capture_fps !== undefined) meta.capture_fps = parseCaptureFps(body.capture_fps)
    if (body.handedness !== undefined) meta.handedness = body.handedness === 'R' || body.handedness === 'L' ? body.handedness : null
    if (body.camera_view !== undefined) {
      meta.camera_view = (['face_on', 'down_the_line', 'other'] as const).find(v => v === body.camera_view) ?? null
    }
    await writeMeta(meta)
    return NextResponse.json({ capture: meta })
  } catch (e) {
    return errorResponse(e)
  }
}

// DELETE — remove the video and everything derived from it.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const { meta } = await authorizeCapture(params.id, 'decide')
    await deleteCapture(meta.id)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return errorResponse(e)
  }
}
