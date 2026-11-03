import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight, BookOpen } from 'lucide-react'
import { getOutline, listPublishedCourses, formatPrice } from '@/lib/academy/server'
import { courseCopy, SITE_URL } from '@/lib/academy/catalog'
import Track from '@/components/academy/Track'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Courses',
  alternates: { canonical: `${SITE_URL}/academy` },
  description: 'BenchCoach Academy: step-by-step youth baseball courses for parents and volunteer coaches. Buy once, keep it, no subscription required.',
}

export default async function AcademyCatalog() {
  const courses = await listPublishedCourses()
  const rows = await Promise.all(courses.map(async c => {
    const o = await getOutline(c.id)
    return { c, copy: courseCopy(c.slug), lessons: o.lessons.filter(l => l.kind === 'lesson').length, modules: o.modules.length }
  }))
  return (
    <div>
      <Track event="academy_landing_view" />
      <section className="bg-[#0f172a] text-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400">BenchCoach Academy</p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold leading-tight">Learn what to coach, in the right order.</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">Written-first courses for parents and volunteer coaches. Buy a course once and keep it — no BenchCoach subscription or team required.</p>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-14 space-y-6">
        {rows.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600" data-testid="catalog-empty">The first course is being prepared. Check back soon.</p>
        )}
        {rows.map(({ c, copy, lessons, modules }) => (
          <article key={c.id} className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm" data-testid="course-card">
            <div className="flex flex-col sm:flex-row sm:items-start gap-6">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-slate-900">{c.title}{c.subtitle ? <span className="text-slate-500 font-semibold">: {c.subtitle}</span> : null}</h2>
                <p className="mt-3 text-slate-700">{copy?.subheadline || c.summary}</p>
                <p className="mt-3 text-sm text-slate-500"><BookOpen className="inline -mt-0.5 mr-1" size={15} />{modules} modules · {lessons} lessons{copy ? ` · ${copy.ages}` : ''}</p>
              </div>
              <div className="sm:text-right shrink-0">
                {formatPrice(c.price_cents, c.currency) && <p className="text-2xl font-bold text-slate-900">{formatPrice(c.price_cents, c.currency)}</p>}
                <Link href={`/academy/${c.slug}`} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">
                  See the course <ArrowRight size={18} />
                </Link>
              </div>
            </div>
          </article>
        ))}
        <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-5 text-sm text-slate-600">
          More topics are planned. They are not available to buy yet, and nothing here is part of a BenchCoach subscription.
        </p>
      </section>
    </div>
  )
}
