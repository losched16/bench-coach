import { NextRequest, NextResponse } from 'next/server'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { requireSession } from '@/lib/authz'
import { verifyVideo, videoPath } from '@/lib/swingPoc/store'
import { authorizeCapture, notEnabled, errorResponse } from '@/lib/swingPoc/access'

// Swing mechanics POC (internal, SWING_MECHANICS_POC=1). See docs/swing-mechanics-poc/.
export const dynamic = 'force-dynamic'

// GET ?token= — the private video, for the signed-in member it was signed for.
// Both checks apply: the session must still be authorized for this player, and
// the token must be this user's, for this capture, and unexpired. Range
// requests are honoured so the browser can seek.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const { meta, userId } = await authorizeCapture(params.id, 'read')
    const token = new URL(request.url).searchParams.get('token') || ''
    if (!verifyVideo(meta.id, userId, token)) {
      return NextResponse.json({ error: 'This video link has expired. Reload the page.' }, { status: 403 })
    }
    const file = videoPath(meta)
    const { size } = await fs.stat(file)
    const headers: Record<string, string> = {
      'Content-Type': meta.mime_type,
      'Accept-Ranges': 'bytes',
      // Private and short-lived: never cached by a shared cache.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    }
    const range = request.headers.get('range')
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start > end || start >= size) {
        return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as any
      return new NextResponse(stream, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      })
    }
    const stream = Readable.toWeb(createReadStream(file)) as any
    return new NextResponse(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  } catch (e) {
    return errorResponse(e)
  }
}
