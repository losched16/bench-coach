import { SeoPage } from '@/lib/supabase'
import { SeoPageCTA } from './SeoPageCTA'
import { SeoPageFAQ } from './SeoPageFAQ'
import { SeoPageRelatedLinks } from './SeoPageRelatedLinks'
import { SeoPageBreadcrumbs } from './SeoPageBreadcrumbs'
import { SeoHubSpokes } from './SeoHubSpokes'
import { SeoMoreInCategory } from './SeoMoreInCategory'
import { SeoSpokeHubBanner } from './SeoSpokeHubBanner'
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

export function SeoPageLayout({ page }: SeoPageLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
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
      <SeoPageBreadcrumbs 
        category={page.category}
        hubSlug={page.hub_slug}
        currentTitle={page.title}
        pageType={page.type}
      />

      {/* Main Content */}
      <article className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
        {/* Age Group Badge */}
        {page.age_group && (
          <div className="mb-4">
            <span className="inline-block px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
              {page.age_group} Baseball
            </span>
          </div>
        )}

        {/* H1 Title */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight">
          {page.title}
        </h1>

        {/* Author info */}
        <div className="flex items-center gap-3 mb-8 pb-8 border-b border-gray-200">
          <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-lg font-bold text-slate-600">
            CL
          </div>
          <div>
            <div className="font-medium text-gray-900">Clint Losch</div>
            <div className="text-sm text-gray-500">Youth Baseball Coach & Founder of BenchCoach</div>
          </div>
        </div>

        {/* For Spoke pages: Show prominent link back to hub */}
        {page.type === 'spoke' && page.hub_slug && (
          <SeoSpokeHubBanner hubSlug={page.hub_slug} />
        )}

        {/* Intro */}
        {page.content.intro && (
          <div 
            className="text-lg sm:text-xl text-gray-600 mb-10 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: linkifyBenchCoach(page.content.intro) }}
          />
        )}

        {/* For Hub pages: Show all spoke pages */}
        {page.type === 'hub' && (
          <SeoHubSpokes hubSlug={page.slug} hubCategory={page.category} />
        )}

        {/* Main Content Sections */}
        <div className="prose prose-lg max-w-none">
          {page.content.sections.map((section, index) => (
            <section key={index} className="mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
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
                <div className="bg-blue-50 border-l-4 border-blue-600 p-5 sm:p-6 my-6 rounded-r-lg">
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
                <div className="bg-orange-50 border-l-4 border-orange-500 p-5 sm:p-6 my-6 rounded-r-lg">
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
            </section>
          ))}
        </div>

        {/* CTA */}
        <SeoPageCTA ageGroup={page.age_group} />

        {/* Related Links */}
        {page.related_slugs && page.related_slugs.length > 0 && (
          <SeoPageRelatedLinks 
            relatedSlugs={page.related_slugs}
            currentCategory={page.category}
          />
        )}

        {/* FAQs */}
        {page.schema_faq && page.schema_faq.length > 0 && (
          <SeoPageFAQ faqs={page.schema_faq} />
        )}

        {/* More in this category - auto-generated */}
        <SeoMoreInCategory 
          currentSlug={page.slug}
          category={page.category}
          ageGroup={page.age_group}
        />
      </article>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
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

      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: page.title,
            description: page.meta_description,
            author: {
              '@type': 'Person',
              name: 'Clint Losch',
              jobTitle: 'Youth Baseball Coach',
            },
            publisher: {
              '@type': 'Organization',
              name: 'BenchCoach',
              url: 'https://mybenchcoach.com',
            },
            datePublished: page.created_at,
            dateModified: page.updated_at,
          }),
        }}
      />
      {page.schema_faq && page.schema_faq.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: page.schema_faq.map((faq) => ({
                '@type': 'Question',
                name: faq.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: faq.answer,
                },
              })),
            }),
          }}
        />
      )}
    </div>
  )
}
