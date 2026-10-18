import { NextRequest, NextResponse } from 'next/server'
import { authorizePlayer, requireSession } from '@/lib/authz'
import { createCapture, listCaptures, readJob, writeMeta, extFor, MAX_UPLOAD_BYTES, videoPath, StoreError, enqueuePrepare } from '@/lib/swingPoc/store'
import { notEnabled, errorResponse } from '@/lib/swingPoc/access'
import { probeFrames } from '@/lib/swingPoc/probe'

// Swing mechanics POC (internal, SWING_MECHANICS_POC=1). See docs/swing-mechanics-poc/.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET ?teamId&playerId — this player's captures, newest first.
export async function GET(request: NextRequest) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const teamId = sp.get('teamId')
    const playerId = sp.get('playerId')
    await authorizePlayer(playerId, { teamId, capability: 'read' })
    const caps = await listCaptures(teamId!, playerId!)
    const rows = await Promise.all(caps.map(async m => ({
      id: m.id, created_at: m.created_at, original_name: m.original_name, size_bytes: m.size_bytes,
      contact_ms: m.contact_history.at(-1)?.t_ms ?? null,
      job: (await readJob(m.id))?.state ?? 'not_analyzed',
    })))
    return NextResponse.json({ captures: rows })
  } catch (e) {
    return errorResponse(e)
  }
}

// POST ?teamId&playerId&handedness&view&setting, body = the raw video bytes.
// Raw rather than multipart so the file streams straight to private storage
// and the size limit is enforced on the bytes received.
export async function POST(request: NextRequest) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const teamId = sp.get('teamId')
    const playerId = sp.get('playerId')
    // Recording a swing is 'record' — the same capability as logging a session.
    const actor = await authorizePlayer(playerId, { teamId, capability: 'record' })
    if (!teamId) throw new StoreError('Choose the team this swing belongs to.', 400)

    const mime = (request.headers.get('content-type') || '').split(';')[0].trim()
    if (!extFor(mime)) throw new StoreError('Upload an MP4, MOV or WebM video.', 415)
    const declared = Number(request.headers.get('content-length') || 0)
    if (declared > MAX_UPLOAD_BYTES) throw new StoreError(`The video is over ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Trim it to the swing.`, 413)
    if (!request.body) throw new StoreError('No video was sent.', 400)

    const meta = await createCapture({
      teamId, playerId: playerId!, userId: actor.userId,
      originalName: request.headers.get('x-file-name') || 'swing',
      mimeType: mime, body: request.body,
      handedness: sp.get('handedness'), cameraView: sp.get('view'), setting: sp.get('setting'),
      captureFps: sp.get('captureFps'),
    })
    // The worker makes a browser-playable copy with the same frame timestamps
    // and proves the alignment (analyzer/swing_analyzer/proxy.py).
    await enqueuePrepare(meta)
    // Immediate frame times for the scrubber; replaced by the worker's
    // playback manifest once the verified copy exists.
    const probe = await probeFrames(videoPath(meta))
    if (probe) {
      ;(meta as any).probe = probe
      await writeMeta(meta)
    }
    return NextResponse.json({ capture: { id: meta.id, frames: probe?.frame_times_ms.length ?? null } }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
