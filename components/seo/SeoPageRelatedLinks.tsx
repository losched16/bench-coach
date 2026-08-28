import { createPublicSupabaseClient } from '@/lib/supabase'
import { RelatedResourceCard } from './RelatedResourceCard'

// Sideways links across the cluster.
//
// This used to render every related page as an identical bordered rectangle
// with a category slug above it, which reads as "more blog posts" and gets
// scrolled past. The pages are not interchangeable, though: one is a plan you
// can print, one is a set of drills, one is a fix for a problem you are having
// right now. Saying which is which is the difference between a link and a
// recommendation.
//
// Same query, same links, same URLs. Only the presentation changed — and a
// click event, so we can tell whether any of this actually moves people
// around the cluster.

interface SeoPageRelatedLinksProps {
  relatedSlugs: string[]
  /** The page these links are being shown on, for the click event. */
  currentPath: string
}

export async function SeoPageRelatedLinks({
  relatedSlugs,
  currentPath,
}: SeoPageRelatedLinksProps) {
  const supabase = createPublicSupabaseClient()

  const { data: relatedPages } = await supabase
    .from('seo_pages')
    .select('slug, category, title, age_group, topic, meta_description')
    .in('slug', relatedSlugs)
    .eq('is_published', true)

  if (!relatedPages || relatedPages.length === 0) return null

  // Restored to the order the author listed them in. `.in()` returns rows in
  // whatever order the database finds them, which is not the order someone
  // chose when they decided what to link first.
  const ordered = relatedSlugs
    .map(slug => (relatedPages as any[]).find(p => p.slug === slug))
    .filter(Boolean)

  return (
    <section className="my-12 border-t border-gray-200 pt-12">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Related Resources</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ordered.map((page: any) => (
          <RelatedResourceCard
            key={page.slug}
            slug={page.slug}
            category={page.category}
            title={page.title}
            ageGroup={page.age_group}
            description={page.meta_description}
            fromPath={currentPath}
            location="related"
          />
        ))}
      </div>
    </section>
  )
}
