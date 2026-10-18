// Shared loader for the protected course pages (/learn/[slug]/…). Decides
// access once, on the server; pages only render what it allows.

import { redirect, notFound } from 'next/navigation'
import { courseAccess, currentUser, getCourse, getOutline, getProgress, isSubscriber, type Access, type AcademyUser, type Course, type Outline, type Progress } from './server'
import type { NavLesson, NavModule } from '@/components/academy/CourseNav'

export interface Shell {
  user: AcademyUser
  course: Course
  outline: Outline
  access: Exclude<Access, 'none'>
  progress: Progress
  subscriber: boolean
  nav: { modules: NavModule[]; lessons: NavLesson[]; completed: number; total: number }
}

/** null = signed in but no access (the page decides what to show). */
export async function loadShell(slug: string, here: string): Promise<Shell | { user: AcademyUser; course: Course; access: 'none' }> {
  const user = await currentUser()
  if (!user) redirect(`/auth/login?redirect=${encodeURIComponent(here)}`)
  const course = await getCourse(slug, user)
  if (!course) notFound()
  const access = await courseAccess(user, course)
  if (access === 'none') return { user, course, access }
  const [outline, progress, subscriber] = await Promise.all([getOutline(course.id), getProgress(user.id, course.id), isSubscriber(user.id)])
  const lessons: NavLesson[] = outline.lessons.map(l => ({
    key: l.lesson_key, title: l.title, number: l.number_label, kind: l.kind, moduleKey: l.module_key, done: !!progress[l.lesson_key]?.completed,
  }))
  const counted = lessons.filter(l => l.kind === 'lesson')
  return {
    user, course, outline, access, progress, subscriber,
    nav: {
      modules: outline.modules.map(m => ({ key: m.module_key, title: m.title, position: m.position })),
      lessons,
      completed: counted.filter(l => l.done).length,
      total: counted.length,
    },
  }
}
