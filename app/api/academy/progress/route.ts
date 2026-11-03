import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { sessionClient } from '@/lib/authz'
import { courseAccess, currentUser, getCourse, getOutline } from '@/lib/academy/server'
import { isLessonKey } from '@/lib/academy/catalog'

// Reading progress: "opened" and "completed" marks on lessons. Completion is
// the reader's acknowledgement, not a claim about the player's skill.
//
// Written with the caller's own session, so the database's row-level security
// (own rows, active enrollment) applies on top of the checks here.
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const { course: slug, lesson, action } = await request.json().catch(() => ({}))
  if (!isLessonKey(lesson) || !['open', 'complete', 'incomplete'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const course = await getCourse(slug)
  if (!course) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })
  if ((await courseAccess(user, course)) !== 'enrolled') {
    return NextResponse.json({ error: 'You do not have access to this course.' }, { status: 403 })
  }
  const outline = await getOutline(course.id)
  if (!outline.lessons.some(l => l.lesson_key === lesson)) return NextResponse.json({ error: 'Unknown lesson.' }, { status: 404 })

  const db = await sessionClient()
  const now = new Date().toISOString()
  const key = { user_id: user.id, course_id: course.id, lesson_key: lesson }
  const { data: existing } = await db.from('academy_lesson_progress').select('lesson_key, completed_at')
    .eq('user_id', user.id).eq('course_id', course.id).eq('lesson_key', lesson).maybeSingle()

  const completed_at = action === 'complete' ? (existing?.completed_at || now) : action === 'incomplete' ? null : existing?.completed_at ?? null
  const { error } = existing
    ? await db.from('academy_lesson_progress').update({ last_opened_at: now, completed_at, content_version: course.content_version })
        .eq('user_id', user.id).eq('course_id', course.id).eq('lesson_key', lesson)
    : await db.from('academy_lesson_progress').insert({ ...key, first_opened_at: now, last_opened_at: now, completed_at, content_version: course.content_version })
  if (error) {
    console.error('Academy progress error:', error.message)
    return NextResponse.json({ error: 'Could not save your progress.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, completed: !!completed_at })
}
