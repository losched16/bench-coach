import { createPublicSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'

interface SeoPageRelatedLinksProps {
  relatedSlugs: string[]
  currentCategory: string
}

export async function SeoPageRelatedLinks({ 
  relatedSlugs,
  currentCategory 
}: SeoPageRelatedLinksProps) {
  const supabase = createPublicSupabaseClient()
  
  const { data: relatedPages } = await supabase
    .from('seo_pages')
    .select('slug, category, title, age_group, topic')
    .in('slug', relatedSlugs)
    .eq('is_published', true)
  
  if (!relatedPages || relatedPages.length === 0) return null
  
  return (
    <div className="my-12 border-t border-gray-200 pt-12">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Related Resources
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {relatedPages.map((page: any) => (
          <Link
            key={page.slug}
            href={`/${page.category}/${page.slug}`}
            className="p-4 border border-gray-200 rounded-lg hover:border-red-400 hover:bg-red-50 transition-colors group"
          >
            <div className="text-xs text-red-600 font-medium mb-1 uppercase tracking-wide">
              {page.category.replace('-', ' ')} {page.age_group && `• ${page.age_group}`}
            </div>
            <div className="font-semibold text-gray-900 group-hover:text-red-700 transition-colors">
              {page.title}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
