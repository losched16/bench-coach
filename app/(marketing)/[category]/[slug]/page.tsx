import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createPublicSupabaseClient, SeoPage } from '@/lib/supabase'
import { SeoPageLayout } from '@/components/seo/SeoPageLayout'

// Revalidate every hour
export const revalidate = 3600

// Allow pages not generated at build time
export const dynamicParams = true

// Generate static params for all published pages
export async function generateStaticParams() {
  const supabase = createPublicSupabaseClient()
  
  const { data: pages } = await supabase
    .from('seo_pages')
    .select('category, slug')
    .eq('is_published', true)
  
  if (!pages) return []
  
  return pages.map((page: any) => ({
    category: page.category,
    slug: page.slug,
  }))
}

// Generate metadata for SEO
export async function generateMetadata({
  params,
}: {
  params: { category: string; slug: string }
}): Promise<Metadata> {
  const supabase = createPublicSupabaseClient()
  
  // Cast at the boundary. Selecting '*' against an untyped client infers
  // `never` for every column, so without this each field access below is a
  // type error even though the query is correct.
  const { data } = await supabase
    .from('seo_pages')
    .select('*')
    .eq('slug', params.slug)
    .eq('category', params.category)
    .eq('is_published', true)
    .single()
  const page = data as SeoPage | null

  if (!page) {
    return {
      title: 'Page Not Found | BenchCoach',
    }
  }
  
  const canonicalUrl = page.canonical || `https://www.mybenchcoach.com/${page.category}/${page.slug}`

  // meta_title is for the search result; page.title is the headline on the
  // page. They are usually the same and occasionally should not be — a title
  // tag can lead with the query a coach typed without the H1 reading like it
  // was written for a crawler. Falls back to the existing behaviour, so no
  // page changes unless someone sets one.
  const titleTag = `${page.meta_title || page.title} | BenchCoach`

  return {
    title: titleTag,
    description: page.meta_description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: page.meta_title || page.title,
      description: page.meta_description,
      url: canonicalUrl,
      type: 'article',
      siteName: 'BenchCoach',
      // The card was declaring summary_large_image with no image to show,
      // which renders as a bare link everywhere these get shared. The logo is
      // not a great social image; it is considerably better than nothing, and
      // it is the only one that exists today.
      images: [{ url: 'https://www.mybenchcoach.com/logo.png' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: page.meta_title || page.title,
      description: page.meta_description,
      images: ['https://www.mybenchcoach.com/logo.png'],
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

// The page component
export default async function SeoPageRoute({
  params,
}: {
  params: { category: string; slug: string }
}) {
  const supabase = createPublicSupabaseClient()
  
  const { data: page, error } = await supabase
    .from('seo_pages')
    .select('*')
    .eq('slug', params.slug)
    .eq('category', params.category)
    .eq('is_published', true)
    .single()

  if (error || !page) {
    notFound()
  }

  return <SeoPageLayout page={page as SeoPage} />
}
