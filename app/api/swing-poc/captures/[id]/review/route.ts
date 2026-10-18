import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { readResult, readReview, writeReview } from '@/lib/swingPoc/store'
import { authorizeCapture, notEnabled, errorResponse } from '@/lib/swingPoc/access'
import { applyReview } from '@/lib/swingPoc/rules'

// Swing mechanics POC (internal, SWING_MECHANICS_POC=1). See docs/swing-mechanics-poc/.
export const dynamic = 'force-dynamic'

// POST { findingId, state, note } — the coach's decision on one finding.
// Stored beside the capture only. Nothing here writes a measurement, a
// priority, a development plan or anything a parent can see.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    // Judging a finding is a coaching decision, so 'decide' — not 'record'.
    const { meta, userId } = await authorizeCapture(params.id, 'decide')
    const body = await request.json().catch(() => ({}))
    const [result, current] = await Promise.all([readResult(meta.id), readReview(meta.id)])
    let review
    try {
      review = applyReview(current, result, { findingId: String(body.findingId || ''), state: String(body.state || ''), note: body.note }, userId)
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    await writeReview(meta.id, review)
    return NextResponse.json({ review })
  } catch (e) {
    return errorResponse(e)
  }
}
