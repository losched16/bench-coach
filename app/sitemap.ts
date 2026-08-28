import { MetadataRoute } from 'next'
import { createPublicSupabaseClient } from '@/lib/supabase'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createPublicSupabaseClient()
  
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: 'https://www.mybenchcoach.com',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://www.mybenchcoach.com/auth/login',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: 'https://www.mybenchcoach.com/auth/signup',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    // Public marketing pages that were being crawled but never submitted.
    // robots.txt allows them, they render server-side, and neither carries a
    // noindex — they were simply missing from the list.
    {
      url: 'https://www.mybenchcoach.com/use-cases',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://www.mybenchcoach.com/subscribe',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]
  
  // Dynamic SEO pages
  const { data: seoPages } = await supabase
    .from('seo_pages')
    .select('slug, category, updated_at, priority, type, canonical')
    .eq('is_published', true)
  
  // A page's own canonical wins when it has one. Submitting /a/b while the
  // page canonicalises to /c/d asks Google to reconcile two URLs for one
  // piece of content, and the sitemap loses that argument.
  const dynamicPages: MetadataRoute.Sitemap = seoPages?.map((page: any) => ({
    url: page.canonical || `https://www.mybenchcoach.com/${page.category}/${page.slug}`,
    lastModified: new Date(page.updated_at),
    changeFrequency: 'monthly' as const,
    priority: page.type === 'hub' ? 0.9 : 0.7,
  })) || []
  
  return [...staticPages, ...dynamicPages]
}
