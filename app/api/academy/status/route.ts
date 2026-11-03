import { NextResponse } from 'next/server'
import { academyVisibleTo } from '@/lib/academy/flag'
import { currentUser } from '@/lib/academy/server'

// Whether to SHOW Academy links to this visitor. Public and read-only: it
// answers a single boolean and nothing about who is asking beyond that.
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser().catch(() => null)
  return NextResponse.json({ enabled: academyVisibleTo(user) }, { headers: { 'Cache-Control': 'no-store' } })
}
