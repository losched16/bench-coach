import { SeoPage, createPublicSupabaseClient } from '@/lib/supabase'
import { SeoPageCTA } from './SeoPageCTA'
import { SeoPageFAQ } from './SeoPageFAQ'
import { SeoPageRelatedLinks } from './SeoPageRelatedLinks'
import { SeoPageBreadcrumbs } from './SeoPageBreadcrumbs'
import { SeoHubSpokes } from './SeoHubSpokes'
import { SeoMoreInCategory } from './SeoMoreInCategory'
import { SeoSpokeHubBanner } from './SeoSpokeHubBanner'
import { SeoResourceSection } from './SeoResourceSection'
import { SeoStructuredData } from './SeoStructuredData'
import { AgeHubPaths } from './AgeHubPaths'
import { readResource } from '@/lib/seoResource'
import Image from 'next/image'
import Link from 'next/link'

interface SeoPageLayoutProps {
  page: SeoPage
}

// Auto-link BenchCoach mentions to homepage (subtle styling)
function linkifyBenchCoach(html: string): string {
  // Don't replace if already in an anchor tag or if it's part of a longer word
  // Replace standalone "BenchCoach" with a subtle link
  return html.replace(
    /(?<!<a[^>]*>)(?<![\/\w])BenchCoach(?![^<]*<\/a>)(?!\w)/g,
    '<a href="/" class="text-red-700 hover:text-red-800 hover:underline font-medium">BenchCoach</a>'
  )
}

/** "March 4, 2026", or null when the stored date is unusable. */
function updatedLabel(value?: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export async function SeoPageLayout({ page }: SeoPageLayoutProps) {
  // The structured half of the page, when the page has one. Null for every
  // page that has not been converted, which is what keeps this change
  // invisible on the ~76 pages outside the pilot: no block, no new markup,
  // byte-for-byte the article they were.
  const block = readResource(page.content)
  const pagePath = `/${page.category}/${page.slug}`

  // Needed for the breadcrumb schema, which has to match the trail the
  // visitor can see. The breadcrumbs component makes the same lookup for its
  // own render; both are hitting a hot, indexed, hourly-revalidated row.
  let hub: { title: string; slug: string; category: string } | null = null
  if (page.type === 'spoke' && page.hub_slug) {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase
      .from('seo_pages')
      .select('title, slug, category')
      .eq('slug', page.hub_slug)
      .single()
    hub = (data as any) || null
  }

  const updated = updatedLabel(page.updated_at)

  return (
    <div className="min-h-screen bg-white">
      <SeoPrintStyles />

      {/* Header — dropped from the printed sheet along with everything else
          that is navigation rather than content. */}
      <header className="print:hidden sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image
              src="/logo.png"
              alt="Bench Coach"
              width={150}
              height={40}
              className="h-10 w-auto"
            />
          </Link>
          <Link
            href="/auth/signup"
            className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            Try Free
          </Link>
        </div>
      </header>

      {/* Breadcrumbs */}
      <div className="print:hidden">
        <SeoPageBreadcrumbs
          category={page.category}
          hubSlug={page.hub_slug}
          currentTitle={page.title}
          pageType={page.type}
        />
      </div>

      {/* Main Content */}
      <article className="max-w-4xl mx-auto px-4 py-8 sm:py-12 print:py-0 print:max-w-none">
        {/* Age Group Badge */}
        {page.age_group && (
          <div className="mb-4">
            <span className="inline-block px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium print:bg-white print:px-0">
              {page.age_group} Baseball
            </span>
          </div>
        )}

        {/* H1 Title */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl print:text-2xl font-bold text-gray-900 mb-6 print:mb-3 leading-tight">
          {page.title}
        </h1>

        {/* Author info. Kept above the fold — a coach deciding whether to
            trust a practice plan is partly deciding whether to trust the
            person who wrote it. */}
        <div className="print:hidden flex flex-wrap items-center gap-3 mb-8 pb-8 border-b border-gray-200">
          <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-lg font-bold text-slate-600">
            CL
          </div>
          <div>
            <div className="font-medium text-gray-900">Clint Losch</div>
            <div className="text-sm text-gray-500">Youth Baseball Coach &amp; Founder of BenchCoach</div>
          </div>
          {updated && (
            <div className="text-sm text-gray-500 sm:ml-auto">
              Updated{' '}
              <time dateTime={page.updated_at}>{updated}</time>
            </div>
          )}
        </div>

        {/* For Spoke pages: Show prominent link back to hub */}
        {page.type === 'spoke' && page.hub_slug && (
          <div className="print:hidden">
            <SeoSpokeHubBanner hubSlug={page.hub_slug} />
          </div>
        )}

        {/* Intro */}
        {page.content.intro && (
          <div
            className="text-lg sm:text-xl print:text-base text-gray-600 mb-10 print:mb-4 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: linkifyBenchCoach(page.content.intro) }}
          />
        )}

        {/* THE UTILITY LAYER.
            Above the prose deliberately: a coach who searched for a practice
            plan should reach the practice plan, not an essay about why 8U is
            a formative age. The essay is still here — it is just no longer
            standing in the doorway. */}
        {block && (
          <SeoResourceSection
            block={block}
            pagePath={pagePath}
            ageGroup={page.age_group}
          />
        )}

        {/* For Hub pages: the four paths, built from the spokes that exist.
            Falls back to the original flat list for hubs that predate it. */}
        {page.type === 'hub' && (
          block?.kind === 'age-hub' ? (
            <div className="print:hidden">
              <AgeHubPaths hubSlug={page.slug} />
            </div>
          ) : (
            <div className="print:hidden">
              <SeoHubSpokes hubSlug={page.slug} hubCategory={page.category} />
            </div>
          )
        )}

        {/* Main Content Sections — the original article, untouched. */}
        <div className="prose prose-lg max-w-none">
          {page.content.sections.map((section, index) => (
            <section key={index} className="mb-10 sm:mb-12 print:mb-6">
              <h2 className="text-2xl sm:text-3xl print:text-lg font-bold text-gray-900 mb-4">
                {section.heading}
              </h2>

              {/* Section body - render HTML */}
              <div
                className="text-gray-700 leading-relaxed mb-6 prose-p:mb-4"
                dangerouslySetInnerHTML={{ __html: linkifyBenchCoach(section.body) }}
              />

              {/* List items */}
              {section.list_items && section.list_items.length > 0 && (
                <ul className="space-y-2 my-6 ml-0 list-none">
                  {section.list_items.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-gray-700">
                      <span className="text-red-600 mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Coaching Cues */}
              {section.coaching_cues && section.coaching_cues.length > 0 && (
                <div className="bg-blue-50 border-l-4 border-blue-600 p-5 sm:p-6 my-6 rounded-r-lg print:bg-white">
                  <h3 className="font-bold text-blue-900 mb-3 text-lg">
                    💡 Coaching Cues
                  </h3>
                  <ul className="space-y-2">
                    {section.coaching_cues.map((cue, i) => (
                      <li key={i} className="text-blue-800 flex items-start gap-2">
                        <span className="text-blue-600">✓</span>
                        <span>{cue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Common Mistakes */}
              {section.common_mistakes && section.common_mistakes.length > 0 && (
                <div className="bg-orange-50 border-l-4 border-orange-500 p-5 sm:p-6 my-6 rounded-r-lg print:bg-white">
                  <h3 className="font-bold text-orange-900 mb-3 text-lg">
                    ⚠️ Common Mistakes to Avoid
                  </h3>
                  <ul className="space-y-2">
                    {section.common_mistakes.map((mistake, i) => (
                      <li key={i} className="text-orange-800 flex items-start gap-2">
                        <span className="text-orange-600">✗</span>
                        <span>{mistake}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Inline CTA Box */}
              {section.cta && (
                <div className="print:hidden bg-gradient-to-r from-red-50 to-red-100 border border-red-200 rounded-xl p-5 sm:p-6 my-6">
                  {section.cta.title && (
                    <h3 className="font-bold text-gray-900 mb-2 text-lg">
                      🎯 {section.cta.title}
                    </h3>
                  )}
                  <p className="text-gray-700 mb-4">{section.cta.body}</p>
                  {section.cta.link_url && section.cta.link_text && (
                    <a
                      href={section.cta.link_url}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
                    >
                      {section.cta.link_text} →
                    </a>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="print:hidden">
          <SeoPageCTA ageGroup={page.age_group} />
        </div>

        {/* Related Links */}
        {page.related_slugs && page.related_slugs.length > 0 && (
          <div className="print:hidden">
            <SeoPageRelatedLinks
              relatedSlugs={page.related_slugs}
              currentPath={pagePath}
            />
          </div>
        )}

        {/* FAQs */}
        {page.schema_faq && page.schema_faq.length > 0 && (
          <div className="print:hidden">
            <SeoPageFAQ faqs={page.schema_faq} />
          </div>
        )}

        {/* More in this category - auto-generated */}
        <div className="print:hidden">
          <SeoMoreInCategory
            currentSlug={page.slug}
            category={page.category}
            ageGroup={page.age_group}
          />
        </div>
      </article>

      {/* Footer */}
      <footer className="print:hidden bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm">© 2025 BenchCoach. Built by coaches, for coaches.</p>
            <div className="flex gap-6 text-sm">
              <Link href="/" className="hover:text-white transition-colors">Home</Link>
              <Link href="/auth/signup" className="hover:text-white transition-colors">Sign Up</Link>
              <Link href="/auth/login" className="hover:text-white transition-colors">Login</Link>
            </div>
          </div>
        </div>
      </footer>

      <SeoStructuredData page={page} block={block} hub={hub} />
    </div>
  )
}

/**
 * Print rules Tailwind's `print:` variant cannot express: the page box, and
 * forcing backgrounds to survive a printer that drops them by default.
 *
 * The printed artifact is the practice, not the web page. Navigation, CTAs,
 * related links and the footer are all `print:hidden` at their call sites;
 * what is left is the schedule, the equipment, the drills and the coaching
 * cues — which is what a coach wants on a clipboard.
 *
 * Deliberately NOT a separate /print URL. A second address serving the same
 * content is a duplicate Google has to reconcile, and the ranking URL is the
 * whole asset here.
 */
function SeoPrintStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
      @media print {
        @page { size: letter portrait; margin: 0.5in; }
        html, body {
          background: #fff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        /* A drill or a schedule row split across a page break is a drill
           nobody can follow at the field. */
        table, tr, li, article { break-inside: avoid; }
        h1, h2, h3 { break-after: avoid; }
        a[href]::after { content: ""; }
      }
    `,
      }}
    />
  )
}
