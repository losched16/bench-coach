import { NextRequest, NextResponse } from 'next/server'
import { adminDb, currentUser } from '@/lib/academy/server'
import { isCourseSlug, isLessonKey } from '@/lib/academy/catalog'

// Academy analytics (Part XII "track events"), into the existing user_events
// table. The user is taken from the session — or recorded as nobody for an
// anonymous visitor. No IP, user agent, email or free text is stored; only a
// known event name, the course and, at most, a lesson key.
export const dynamic = 'force-dynamic'

const EVENTS = new Set([
  'academy_landing_view', 'academy_course_view', 'preview_started', 'course_checkout_started',
  'first_lesson_started', 'lesson_completed', 'module_completed', 'course_completed', 'software_cta_clicked',
])

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { event, course, lesson } = body || {}
  if (!EVENTS.has(event) || (course != null && !isCourseSlug(course)) || (lesson != null && !isLessonKey(lesson))) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const user = await currentUser()
  try {
    await adminDb().from('user_events').insert({
      user_id: user?.id ?? null,
      event_type: 'academy',
      event_name: event,
      page_path: course ? `/academy/${course}` : '/academy',
      metadata: { course: course ?? null, lesson: lesson ?? null },
    })
  } catch { /* analytics never breaks the page */ }
  return NextResponse.json({ ok: true })
}
