import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createPublicSupabaseClient, SeoPage } from '@/lib/supabase'
import { SeoPageLayout } from '@/components/seo/SeoPageLayout'

// Revalidate every hour
export const revalidate = 3600

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
  
  const { data: page } = await supabase
    .from('seo_pages')
    .select('*')
    .eq('slug', params.slug)
    .eq('category', params.category)
    .eq('is_published', true)
    .single()
  
  if (!page) {
    return {
      title: 'Page Not Found | BenchCoach',
    }
  }
  
  const canonicalUrl = page.canonical || `https://mybenchcoach.com/${page.category}/${page.slug}`
  
  return {
    title: `${page.title} | BenchCoach`,
    description: page.meta_description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: page.title,
      description: page.meta_description,
      url: canonicalUrl,
      type: 'article',
      siteName: 'BenchCoach',
    },
    twitter: {
      card: 'summary_large_image',
      title: page.title,
      description: page.meta_description,
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
