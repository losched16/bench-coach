import { SeoPage } from '@/lib/supabase'
import { ResourceBlock, rowTimeLabel, rowMinutes, totalMinutes, SITE_ORIGIN } from '@/lib/seoResource'

// Structured data for an SEO page.
//
// One rule governs everything here: schema describes what a visitor can
// actually see on the page. Nothing is emitted speculatively, nothing is
// emitted because it might win a rich result, and no rating, review, author
// credential or date is manufactured. Markup that overstates the page is the
// kind of thing that costs a site its rich results across the board, and
// these four URLs are too valuable to gamble.
//
// So: BreadcrumbList always, because the breadcrumb trail is rendered right
// there. Article always, as before. HowTo only for a practice plan that
// really does render a step-by-step schedule. FAQPage only when visible FAQs
// exist, which was already the rule.

interface SeoStructuredDataProps {
  page: SeoPage
  block: ResourceBlock | null
  hub?: { title: string; slug: string; category: string } | null
}

/** ISO 8601 duration. 60 → "PT60M". */
function isoMinutes(m: number): string {
  return `PT${m}M`
}

export function SeoStructuredData({ page, block, hub }: SeoStructuredDataProps) {
  const url = page.canonical || `${SITE_ORIGIN}/${page.category}/${page.slug}`

  // The visible trail in SeoPageBreadcrumbs includes the category as an
  // unlinked label, but that level is omitted here: Google requires `item`
  // on every ListItem except the last, there is no category page to point
  // at, and inventing one would be markup describing a URL that 404s. A
  // BreadcrumbList is allowed to skip levels; it is not allowed a linkless
  // middle entry — Search Console rejects the whole list as invalid.
  const crumbs: any[] = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN },
  ]
  if (hub) {
    crumbs.push({
      '@type': 'ListItem',
      position: crumbs.length + 1,
      name: hub.title,
      item: `${SITE_ORIGIN}/${hub.category}/${hub.slug}`,
    })
  }
  crumbs.push({
    '@type': 'ListItem',
    position: crumbs.length + 1,
    name: page.title,
    item: url,
  })

  const graph: any[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.title,
      description: page.meta_description,
      mainEntityOfPage: url,
      author: {
        '@type': 'Person',
        name: 'Clint Losch',
        jobTitle: 'Youth Baseball Coach',
      },
      publisher: {
        '@type': 'Organization',
        name: 'BenchCoach',
        url: SITE_ORIGIN,
      },
      datePublished: page.created_at,
      dateModified: page.updated_at,
    },
  ]

  // A practice plan with a real schedule is a HowTo, and the steps below are
  // the same rows the page renders. Skipped entirely without a timeline —
  // there would be no steps to describe.
  if (block?.kind === 'practice-plan' && block.timeline?.length) {
    const total = totalMinutes(block.timeline)
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: page.title,
      description: page.meta_description,
      ...(total ? { totalTime: isoMinutes(total) } : {}),
      ...(block.equipment?.length
        ? { supply: block.equipment.map(item => ({ '@type': 'HowToSupply', name: item })) }
        : {}),
      step: block.timeline.map((row, i) => {
        const mins = rowMinutes(row)
        return {
          '@type': 'HowToStep',
          position: i + 1,
          name: row.activity,
          ...(row.focus ? { text: row.focus } : {}),
          ...(mins ? { timeRequired: isoMinutes(mins) } : {}),
          ...(rowTimeLabel(row) ? { url: `${url}#practice-timeline` } : {}),
        }
      }),
    })
  }

  if (page.schema_faq && page.schema_faq.length > 0) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.schema_faq.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    })
  }

  return (
    <>
      {graph.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
    </>
  )
}
