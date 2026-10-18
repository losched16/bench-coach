import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { enqueue, readJob, StoreError } from '@/lib/swingPoc/store'
import { authorizeCapture, notEnabled, errorResponse } from '@/lib/swingPoc/access'

// Swing mechanics POC (internal, SWING_MECHANICS_POC=1). See docs/swing-mechanics-poc/.
export const dynamic = 'force-dynamic'

// POST — queue the analysis. Returns at once; the page polls the capture for
// the job state. Nothing long-running happens in this request.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const { meta } = await authorizeCapture(params.id, 'record')
    const contact = meta.contact_history.at(-1)
    if (!contact) throw new StoreError('Mark the contact frame first — the analysis is anchored to it.', 400)
    const job = await readJob(meta.id)
    if (job && (job.state === 'queued' || job.state === 'processing')) {
      return NextResponse.json({ job }, { status: 202 })
    }
    const fs = meta.event_tags?.foot_strike
    if (fs && fs.t_ms >= contact.t_ms) throw new StoreError('Foot strike must come before contact.', 400)
    await enqueue(meta, {
      contact_ms: contact.t_ms, handedness: meta.handedness, camera_view: meta.camera_view,
      foot_strike_ms: fs ? fs.t_ms : null,
      capture_fps: meta.capture_fps ?? null,
    })
    return NextResponse.json({ job: await readJob(meta.id) }, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
