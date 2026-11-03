import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import { courseAccess, currentUser, formatPrice, getCourse, getLessonBody, getOutline, getVideos } from '@/lib/academy/server'
import { courseCopy, SITE_URL } from '@/lib/academy/catalog'
import LessonBlocks from '@/components/academy/LessonBlocks'
import VideoLinks from '@/components/academy/VideoLinks'
import BuyButton from '@/components/academy/BuyButton'
import Track from '@/components/academy/Track'

// The free preview: one published lesson, readable by anyone, signed in or
// not. Only the lesson flagged is_preview is served here — the same rule the
// database enforces on lesson text.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const course = await getCourse(params.slug)
  if (!course) return { title: 'Course not found', robots: { index: false } }
  const preview = (await getOutline(course.id)).lessons.find(l => l.is_preview)
  return {
    title: preview ? `Free lesson: ${preview.title}` : 'Free preview',
    description: courseCopy(course.slug)?.subheadline,
    alternates: { canonical: `${SITE_URL}/academy/${course.slug}/preview` },
  }
}

export default async function PreviewPage({ params }: { params: { slug: string } }) {
  const user = await currentUser()
  const course = await getCourse(params.slug, user)
  const copy = courseCopy(params.slug)
  if (!course || !copy) notFound()
  const outline = await getOutline(course.id)
  const lesson = outline.lessons.find(l => l.is_preview)
  if (!lesson) notFound()
  const owner = course.status !== 'published'
  const body = await getLessonBody(course, lesson.lesson_key, owner ? 'owner' : 'session')
  if (!body) notFound()
  const videos = await getVideos(course.id, lesson.lesson_key)
  const access = await courseAccess(user, course)
  const onSale = course.status === 'published' && !!course.price_cents && !!course.stripe_price_id
  const mod = outline.modules.find(m => m.module_key === lesson.module_key)

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
      <Track event="preview_started" course={course.slug} lesson={lesson.lesson_key} />
      <Link href={`/academy/${course.slug}`} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft size={16} /> {course.title}</Link>
      <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-900">Free preview lesson — no account needed.</div>
      <header className="mt-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-red-700">{mod ? `Module ${mod.position} · ${mod.title}` : 'Lesson'}</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900">{lesson.number_label ? `${lesson.number_label} ` : ''}{lesson.title}</h1>
        {lesson.est_minutes && <p className="mt-2 text-sm text-slate-500">About {lesson.est_minutes} min read</p>}
      </header>
      <article className="mt-8" data-testid="lesson-body">
        <LessonBlocks blocks={body.blocks} safetyNote={course.safety_note} />
      </article>
      <div className="mt-8"><VideoLinks videos={videos} /></div>
      <section className="mt-12 rounded-2xl bg-[#0f172a] p-6 sm:p-8 text-white">
        <h2 className="text-2xl font-bold">{copy.headline}</h2>
        <p className="mt-3 text-slate-300">This was lesson {lesson.number_label} of {outline.lessons.filter(l => l.kind === 'lesson').length}. The full course continues through the load, stride, rotation, contact and timing, with a four-week program and troubleshooting guide.</p>
        <div className="mt-6">
          {access === 'enrolled'
            ? <Link href={`/learn/${course.slug}`} className="inline-flex rounded-lg bg-red-600 px-6 py-3 font-semibold hover:bg-red-700">Continue the course</Link>
            : <Suspense fallback={null}><BuyButton slug={course.slug} label={copy.ctaLabel} price={formatPrice(course.price_cents, course.currency)} onSale={onSale} signedIn={!!user} /></Suspense>}
        </div>
      </section>
    </div>
  )
}
