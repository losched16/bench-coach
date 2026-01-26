import { MetadataRoute } from 'next'
import { createPublicSupabaseClient } from '@/lib/supabase'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createPublicSupabaseClient()
  
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: 'https://mybenchcoach.com',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://mybenchcoach.com/auth/login',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: 'https://mybenchcoach.com/auth/signup',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ]
  
  // Dynamic SEO pages
  const { data: seoPages } = await supabase
    .from('seo_pages')
    .select('slug, category, updated_at, priority, type')
    .eq('is_published', true)
  
  const dynamicPages: MetadataRoute.Sitemap = seoPages?.map((page: any) => ({
    url: `https://mybenchcoach.com/${page.category}/${page.slug}`,
    lastModified: new Date(page.updated_at),
    changeFrequency: 'monthly' as const,
    priority: page.type === 'hub' ? 0.9 : 0.7,
  })) || []
  
  return [...staticPages, ...dynamicPages]
}
