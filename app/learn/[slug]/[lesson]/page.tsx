import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { loadShell } from '@/lib/academy/shell'
import { getLessonBody, getVideos, neighbours } from '@/lib/academy/server'
import { courseCopy, isLessonKey } from '@/lib/academy/catalog'
import CourseNav from '@/components/academy/CourseNav'
import LessonBlocks, { FieldTest } from '@/components/academy/LessonBlocks'
import VideoLinks from '@/components/academy/VideoLinks'
import CompleteButton from '@/components/academy/CompleteButton'
import PrintButton from '@/components/academy/PrintButton'
import Handoff from '@/components/academy/Handoff'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function LessonPage({ params }: { params: { slug: string; lesson: string } }) {
  if (!isLessonKey(params.lesson)) notFound()
  const here = `/learn/${params.slug}/${params.lesson}`
  const s = await loadShell(params.slug, here)
  if (s.access === 'none') {
    // No enrollment: the preview lesson has its own public page; anything
    // else goes to the course page to buy. No lesson text is read.
    redirect(`/academy/${s.course.slug}?access=required`)
  }
  const { course, outline, progress, nav, subscriber } = s
  const lesson = outline.lessons.find(l => l.lesson_key === params.lesson)
  if (!lesson) notFound()
  const body = await getLessonBody(course, lesson.lesson_key, s.access === 'owner_preview' ? 'owner' : 'session')
  if (!body) notFound()
  const videos = lesson.kind === 'lesson' ? await getVideos(course.id, lesson.lesson_key) : []
  const { prev, next } = neighbours(outline, lesson.lesson_key)
  const mod = outline.modules.find(m => m.module_key === lesson.module_key) || null
  const inModule = outline.lessons.filter(l => l.module_key && l.module_key === lesson.module_key)
  const lastOfModule = !!mod && inModule[inModule.length - 1]?.lesson_key === lesson.lesson_key
  const lessonsOnly = outline.lessons.filter(l => l.kind === 'lesson')
  const lastLesson = lessonsOnly[lessonsOnly.length - 1]?.lesson_key === lesson.lesson_key
  const done = !!progress[lesson.lesson_key]?.completed
  const othersInModuleDone = inModule.filter(l => l.lesson_key !== lesson.lesson_key).every(l => progress[l.lesson_key]?.completed)
  const othersDone = lessonsOnly.filter(l => l.lesson_key !== lesson.lesson_key).every(l => progress[l.lesson_key]?.completed)
  const isFirstOpen = Object.keys(progress).length === 0
  const copy = courseCopy(course.slug)
  const enrolled = s.access === 'enrolled'

  return (
    <div className="mx-auto max-w-7xl lg:px-6 lg:py-8 lg:flex lg:gap-10">
      <CourseNav slug={course.slug} current={lesson.lesson_key} {...nav} />
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-0 py-6 lg:py-0">
        <div className="mx-auto max-w-3xl">
          {s.access === 'owner_preview' && <p className="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-900 print:hidden">Owner preview — you are not enrolled; progress is not saved.</p>}
          <header>
            <p className="text-sm font-semibold uppercase tracking-wider text-red-700">
              {mod ? `Module ${mod.position} · ${mod.title}` : lesson.kind === 'resource' ? 'Practice resource' : 'Start here'}
            </p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-bold leading-tight text-slate-900" data-testid="lesson-title">
              {lesson.number_label ? `${lesson.number_label} ` : ''}{lesson.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {lesson.est_minutes && <span>About {lesson.est_minutes} min read</span>}
              {lesson.kind === 'resource' && <PrintButton label="Print or save as PDF" />}
            </div>
          </header>

          <article className="mt-8" data-testid="lesson-body">
            <LessonBlocks blocks={body.blocks} safetyNote={lesson.kind === 'lesson' ? course.safety_note : null} />
          </article>

          {body.field_test && <div className="mt-8"><FieldTest text={body.field_test} moduleTitle={mod ? `Module ${mod.position}` : undefined} /></div>}
          {lesson.kind === 'lesson' && <div className="mt-8"><VideoLinks videos={videos} /></div>}

          <div className="mt-10 border-t border-slate-200 pt-6 space-y-6 print:hidden">
            {lesson.kind === 'lesson' && enrolled && (
              <CompleteButton slug={course.slug} lesson={lesson.lesson_key} completed={done} isFirstOpen={isFirstOpen}
                completesModule={othersInModuleDone} completesCourse={othersDone} />
            )}
            <nav className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3" aria-label="Lesson navigation">
              {prev ? (
                <Link href={`/learn/${course.slug}/${prev.lesson_key}`} className="inline-flex min-w-0 sm:max-w-[49%] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-800 hover:bg-slate-50" data-testid="prev">
                  <ArrowLeft size={18} className="shrink-0" /> <span className="truncate">{prev.number_label ? `${prev.number_label} ` : ''}{prev.title}</span>
                </Link>
              ) : <Link href={`/learn/${course.slug}`} className="inline-flex min-w-0 sm:max-w-[49%] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-800 hover:bg-slate-50"><ArrowLeft size={18} /> Course overview</Link>}
              {next ? (
                <Link href={`/learn/${course.slug}/${next.lesson_key}`} className="inline-flex min-w-0 sm:max-w-[49%] items-center justify-end gap-2 rounded-lg bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700" data-testid="next">
                  <span className="truncate">Next: {next.number_label ? `${next.number_label} ` : ''}{next.title}</span> <ArrowRight size={18} className="shrink-0" />
                </Link>
              ) : <Link href={`/learn/${course.slug}`} className="inline-flex min-w-0 sm:max-w-[49%] items-center justify-end gap-2 rounded-lg bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700">Back to the course <ArrowRight size={18} /></Link>}
            </nav>
            {copy && lastOfModule && !lastLesson && <Handoff copy={copy} slug={course.slug} subscriber={subscriber} variant="module" />}
            {copy && lastLesson && <Handoff copy={copy} slug={course.slug} subscriber={subscriber} variant="course" />}
          </div>
        </div>
      </main>
    </div>
  )
}
