import CtaLink from './CtaLink'
import type { CourseCopy } from '@/lib/academy/catalog'

// The optional software handoff (manuscript Part XI). Never a condition of
// access. Subscribers are pointed at the Development Plans that already
// exist — "Create My Swing Development Plan" is not offered until that flow
// is built and verified (docs/academy/DECISIONS.md).
export default function Handoff({ copy, slug, subscriber, variant }: { copy: CourseCopy; slug: string; subscriber: boolean; variant: 'module' | 'course' }) {
  if (variant === 'module') {
    return (
      <p className="text-sm text-slate-500 print:hidden" data-testid="module-handoff">
        Want to track this with a player? {subscriber
          ? <CtaLink href="/dashboard/development" course={slug} className="underline hover:text-slate-800">Open Development Plans in BenchCoach</CtaLink>
          : <CtaLink href="/subscribe" course={slug} className="underline hover:text-slate-800">BenchCoach can help (optional)</CtaLink>}
      </p>
    )
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 print:hidden" data-testid="course-handoff">
      <h2 className="text-2xl font-bold text-slate-900">{copy.handoff.title}</h2>
      <p className="mt-3 text-slate-700">{copy.handoff.body}</p>
      <p className="mt-2 text-slate-600">{copy.handoff.keep}</p>
      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        {subscriber ? (
          <CtaLink href="/dashboard/development" course={slug} className="inline-flex justify-center rounded-lg bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700">Open Development Plans</CtaLink>
        ) : (
          <CtaLink href="/subscribe" course={slug} className="inline-flex justify-center rounded-lg bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700">Build a Player Development Plan in BenchCoach</CtaLink>
        )}
        <a href={`/learn/${slug}/four-week-program`} className="inline-flex justify-center rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-800 hover:bg-slate-50">Use the printable four-week program</a>
      </div>
      {!subscriber && <p className="mt-3 text-xs text-slate-500">Optional. BenchCoach is a separate subscription with a 14-day trial; your course does not depend on it.</p>}
    </section>
  )
}
