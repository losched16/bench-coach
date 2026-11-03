import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, CheckCircle2, Circle, BookOpen, Printer } from 'lucide-react'
import { loadShell } from '@/lib/academy/shell'
import { courseCopy } from '@/lib/academy/catalog'
import CourseNav from '@/components/academy/CourseNav'
import PurchaseConfirm from '@/components/academy/PurchaseConfirm'
import Handoff from '@/components/academy/Handoff'

export const dynamic = 'force-dynamic'

export default async function CourseHome({ params, searchParams }: { params: { slug: string }; searchParams: { purchase?: string; session_id?: string; welcome?: string } }) {
  const here = `/learn/${params.slug}`
  const s = await loadShell(params.slug, here)
  if (s.access === 'none') {
    // Just back from Stripe: verify with Stripe (server-side) and wait for the
    // enrollment. Anyone else without access goes to the course page to buy.
    if (searchParams.purchase === 'success') {
      return <div className="px-4 py-16"><PurchaseConfirm slug={s.course.slug} sessionId={searchParams.session_id || null} /></div>
    }
    redirect(`/academy/${s.course.slug}?access=required`)
  }
  const { course, outline, progress, nav, subscriber } = s
  const copy = courseCopy(course.slug)
  const lessons = outline.lessons.filter(l => l.kind === 'lesson')
  const resume = lessons.find(l => !progress[l.lesson_key]?.completed) || null
  const started = Object.keys(progress).length > 0
  const firstIntro = outline.lessons.find(l => l.kind === 'intro')
  const nextHref = !started && firstIntro ? `/learn/${course.slug}/${firstIntro.lesson_key}` : resume ? `/learn/${course.slug}/${resume.lesson_key}` : null
  const allDone = nav.total > 0 && nav.completed === nav.total

  return (
    <div className="mx-auto max-w-7xl lg:px-6 lg:py-8 lg:flex lg:gap-10">
      <CourseNav slug={course.slug} current={null} {...nav} />
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-0 py-8 lg:py-0 space-y-8">
        {s.access === 'owner_preview' && <p className="rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-900">Owner preview — you are not enrolled; progress is not saved.</p>}
        {(searchParams.welcome === '1' || searchParams.purchase === 'success') && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-900" role="status" data-testid="welcome">
            <strong>You&apos;re in.</strong> The course is yours — it doesn&apos;t need a BenchCoach subscription or a team.
          </div>
        )}
        <header>
          <p className="text-sm font-semibold uppercase tracking-wider text-red-700">BenchCoach Academy</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900">{course.title}</h1>
          {course.subtitle && <p className="mt-1 text-xl text-slate-500">{course.subtitle}</p>}
          <p className="mt-4 text-slate-700 max-w-2xl">{nav.completed} of {nav.total} lessons read. Marking a lesson complete means you&apos;ve read it — the player&apos;s progress is what you see at practice.</p>
          {nextHref && (
            <Link href={nextHref} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700" data-testid="resume">
              {started ? `Continue: ${resume?.number_label} ${resume?.title}` : 'Start the course'} <ArrowRight size={18} />
            </Link>
          )}
        </header>

        <section>
          <h2 className="text-lg font-bold text-slate-900">Start here</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {outline.lessons.filter(l => l.kind === 'intro').map(l => (
              <li key={l.lesson_key}><Link href={`/learn/${course.slug}/${l.lesson_key}`} className="flex h-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 hover:border-slate-300"><BookOpen size={18} className="mt-0.5 shrink-0 text-slate-400" />{l.title.replace(/:.*$/, '')}</Link></li>
            ))}
          </ul>
        </section>

        {outline.modules.map(m => {
          const ls = outline.lessons.filter(l => l.module_key === m.module_key)
          const done = ls.filter(l => progress[l.lesson_key]?.completed).length
          return (
            <section key={m.module_key} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="module">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-red-700">Module {m.position}</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-900">{m.title}</h2>
                  {m.subtitle && <p className="text-slate-500">{m.subtitle}</p>}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">{done}/{ls.length}</span>
              </div>
              {m.outcome && <p className="mt-3 text-[15px] text-slate-700"><span className="font-semibold">Module outcome:</span> {m.outcome}</p>}
              <ul className="mt-4 divide-y divide-slate-100">
                {ls.map(l => (
                  <li key={l.lesson_key}>
                    <Link href={`/learn/${course.slug}/${l.lesson_key}`} className="flex items-center gap-3 py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg">
                      {progress[l.lesson_key]?.completed ? <CheckCircle2 className="shrink-0 text-emerald-600" size={20} aria-label="completed" /> : <Circle className="shrink-0 text-slate-300" size={20} aria-label="not completed" />}
                      <span className="tabular-nums text-slate-500 w-8">{l.number_label}</span>
                      <span className="flex-1 text-slate-800">{l.title}</span>
                      {l.est_minutes && <span className="hidden sm:inline text-xs text-slate-400">{l.est_minutes} min</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

        <section>
          <h2 className="text-lg font-bold text-slate-900">Practice resources</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {outline.lessons.filter(l => l.kind === 'resource').map(l => (
              <li key={l.lesson_key}><Link href={`/learn/${course.slug}/${l.lesson_key}`} className="flex h-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 hover:border-slate-300"><Printer size={18} className="mt-0.5 shrink-0 text-slate-400" />{l.title}</Link></li>
            ))}
            <li><Link href={`/learn/${course.slug}/checklist`} className="flex h-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 hover:border-slate-300"><Printer size={18} className="mt-0.5 shrink-0 text-slate-400" />Printable progress checklist</Link></li>
          </ul>
        </section>

        {copy && allDone && <Handoff copy={copy} slug={course.slug} subscriber={subscriber} variant="course" />}
      </main>
    </div>
  )
}
