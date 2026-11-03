import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { currentUser, getCourse, getEnrollment } from '@/lib/academy/server'

// Does the signed-in user have this course? Their own answer only.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const course = await getCourse(request.nextUrl.searchParams.get('course') || '')
  if (!course) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })
  const e = await getEnrollment(user.id, course.id)
  return NextResponse.json({ status: e?.status ?? 'none' }, { headers: { 'Cache-Control': 'no-store' } })
}
