import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ArrowRight, Check, X, Eye, BookOpen } from 'lucide-react'
import { courseAccess, currentUser, formatPrice, getCourse, getOutline } from '@/lib/academy/server'
import { courseCopy, SITE_URL } from '@/lib/academy/catalog'
import BuyButton from '@/components/academy/BuyButton'
import Track from '@/components/academy/Track'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const course = await getCourse(params.slug)
  const copy = courseCopy(params.slug)
  if (!course || !copy) return { title: 'Course not found', robots: { index: false } }
  return {
    title: `${course.title}${course.subtitle ? `: ${course.subtitle}` : ''}`,
    description: copy.subheadline,
    alternates: { canonical: `${SITE_URL}/academy/${course.slug}` },
    openGraph: { title: copy.headline, description: copy.subheadline, url: `${SITE_URL}/academy/${course.slug}`, type: 'website' },
  }
}

export default async function CoursePage({ params, searchParams }: { params: { slug: string }; searchParams: { checkout?: string } }) {
  const user = await currentUser()
  const course = await getCourse(params.slug, user)
  const copy = courseCopy(params.slug)
  if (!course || !copy) notFound()
  const outline = await getOutline(course.id)
  const access = await courseAccess(user, course)
  const price = formatPrice(course.price_cents, course.currency)
  const onSale = course.status === 'published' && !!course.price_cents && !!course.stripe_price_id
  const lessons = outline.lessons.filter(l => l.kind === 'lesson')
  const preview = outline.lessons.find(l => l.is_preview)

  const cta = (autoStart: boolean) => access === 'enrolled' ? (
    <Link href={`/learn/${course.slug}`} className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-red-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-red-700" data-testid="continue">
      Continue the course <ArrowRight size={20} />
    </Link>
  ) : (
    <Suspense fallback={null}>
      <BuyButton slug={course.slug} label={copy.ctaLabel} price={price} onSale={onSale} signedIn={!!user} autoStart={autoStart} />
    </Suspense>
  )

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: `${course.title}${course.subtitle ? `: ${course.subtitle}` : ''}`,
    description: copy.subheadline,
    url: `${SITE_URL}/academy/${course.slug}`,
    provider: { '@type': 'Organization', name: 'BenchCoach', sameAs: SITE_URL },
    ...(onSale ? { offers: { '@type': 'Offer', price: (course.price_cents! / 100).toFixed(2), priceCurrency: course.currency.toUpperCase(), category: 'Paid' } } : {}),
  }

  return (
    <div>
      <Track event="academy_course_view" course={course.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      {course.status !== 'published' && (
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm text-amber-900" data-testid="draft-banner">
          Draft — only you can see this page. It is not for sale until it is published with a price.
        </div>
      )}
      {searchParams.checkout === 'cancelled' && (
        <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-center text-sm text-slate-700" role="status">Checkout cancelled — you have not been charged.</div>
      )}

      <section className="bg-[#0f172a] text-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-12 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400">{course.title}{course.subtitle ? ` · ${course.subtitle}` : ''}</p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold leading-tight max-w-3xl">{copy.headline}</h1>
          <p className="mt-5 max-w-3xl text-lg text-slate-300">{copy.subheadline}</p>
          <div className="mt-8 flex flex-col sm:flex-row sm:items-start gap-4">
            {cta(true)}
            {preview && access !== 'enrolled' && (
              <Link href={`/academy/${course.slug}/preview`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-500 px-6 py-4 font-semibold text-white hover:bg-white/10" data-testid="preview-link">
                <Eye size={18} /> {copy.previewLabel}
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-12 space-y-14">
        <section className="grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Who it&apos;s for</h2>
            <p className="mt-3 text-slate-700 text-lg">{copy.whoFor}</p>
            <p className="mt-3 text-slate-600">{copy.ages}</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">What you&apos;ll learn</h2>
            <ul className="mt-3 space-y-2">
              {copy.learn.map(x => <li key={x} className="flex gap-2 text-slate-700"><Check className="mt-1 shrink-0 text-emerald-600" size={18} />{x}</li>)}
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-900">The curriculum</h2>
          <p className="mt-2 text-slate-600">{outline.modules.length} modules · {lessons.length} lessons, plus a starting assessment, a four-week program and a troubleshooting guide.</p>
          <ol className="mt-6 grid gap-4 md:grid-cols-2" data-testid="curriculum">
            {outline.modules.map(m => (
              <li key={m.module_key} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-red-700">Module {m.position}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{m.title}</h3>
                {m.subtitle && <p className="text-sm text-slate-500">{m.subtitle}</p>}
                <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                  {outline.lessons.filter(l => l.module_key === m.module_key).map(l => (
                    <li key={l.lesson_key} className="flex gap-2">
                      <span className="tabular-nums text-slate-400 w-7 shrink-0">{l.number_label}</span>
                      <span>{l.title}{l.is_preview && <Link href={`/academy/${course.slug}/preview`} className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">Free preview</Link>}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid md:grid-cols-2 gap-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-bold text-slate-900">What you get</h2>
            <ul className="mt-3 space-y-2">
              {copy.getItems.map(x => <li key={x} className="flex gap-2 text-slate-700"><BookOpen className="mt-1 shrink-0 text-slate-400" size={16} />{x}</li>)}
            </ul>
            <p className="mt-4 text-sm text-slate-600">{copy.softwareNote}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-bold text-slate-900">What this course does not promise</h2>
            <ul className="mt-3 space-y-2">
              {copy.notPromised.map(x => <li key={x} className="flex gap-2 text-slate-700"><X className="mt-1 shrink-0 text-slate-400" size={16} />{x}</li>)}
            </ul>
          </div>
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Who made it</h2>
          <p className="mt-3 text-slate-700 leading-relaxed">{copy.credibility}</p>
        </section>

        <section className="text-center pb-6">
          <h2 className="text-2xl font-bold text-slate-900">{access === 'enrolled' ? 'Pick up where you left off.' : `${course.title}${course.subtitle ? `: ${course.subtitle}` : ''}`}</h2>
          <div className="mt-6 flex justify-center">{cta(false)}</div>
        </section>
      </div>
    </div>
  )
}
